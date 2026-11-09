import type { CheckResult, SonarChallenge, SonarEvidence } from '@knock/shared'
import {
  chanceCorrelation,
  grid,
  peakCrossCorrelation,
  resample,
  standardise,
  variationCoefficient,
  type Sample,
} from './signal.ts'

/**
 * SonarGuard-style liveness, in two questions:
 *  1) Is something physical moving in front of the device? The near-ultrasonic
 *     echo carries Doppler only if it does — a video played into a virtual
 *     camera leaves the echo static.
 *  2) Does that movement match the mouth seen in the video? The Doppler energy
 *     should rise and fall with |d(mouth aperture)/dt|.
 *
 * This proves presence and audio/video consistency, NOT identity: someone
 * physically present running a live face-swap passes. The light check covers
 * that case.
 */

/** Analysis grid: above mouth-motion bandwidth, below camera frame rate. */
const GRID_HZ = 20
/**
 * Lag search range, deliberately asymmetric. Video arrives through a camera
 * pipeline that delays it by up to a few hundred ms, so the echo legitimately
 * leads the lips; the reverse is not physical beyond the audio input buffer.
 * Every extra lag searched also raises the chance peak, so the range is kept
 * as tight as the physics allows.
 */
const MIN_LAG_MS = -400
const MAX_LAG_MS = 100
/** Below this the carrier never made it through the speaker→mic path. */
const MIN_CARRIER_SNR_DB = 6
/** Fraction of the issued window the evidence has to actually cover. */
const MIN_COVERAGE = 0.6
/** Upper bound on the same, to reject nonsense timestamps. */
const MAX_COVERAGE = 2
const MIN_DOPPLER_FRAMES = 20
const MIN_MOUTH_FRAMES = 10
/** Doppler RMS has to vary this much relative to its mean to count as movement. */
const MIN_DOPPLER_VARIATION = 0.05
/** Mouth has to swing this much, as a fraction of face height, to be speech. */
const MIN_MOUTH_SWING = 0.01
/**
 * How far the peak must rise above coincidence to call the two series the
 * same event. PROVISIONAL — see README: it needs a calibration set of real
 * runs on real hardware, which does not exist yet.
 */
const PASS_EXCESS = 0.15
/**
 * Above this, coincidence alone already reaches a high correlation on this
 * evidence — rhythmic mouth motion aligns with a rhythmic echo at almost any
 * lag — and the comparison cannot separate a live speaker from a replay. The
 * honest verdict is then that we could not tell, not that the user failed.
 */
const MAX_CHANCE = 0.5

export function verifySonar(challenge: SonarChallenge, ev: SonarEvidence): CheckResult {
  // Every verdict carries the measurements behind it: a sonar failure is
  // otherwise impossible to tell apart from bad lighting, a slow landmarker or
  // a user who started speaking late.
  const measured = [
    `carrier SNR ${fmt(ev.carrierSnrDb)} dB`,
    `doppler ${ev.doppler.length} frames @ ${fmt(rateHz(ev.doppler), 0)} Hz`,
    `mouth ${ev.mouthAperture.length} frames @ ${fmt(rateHz(ev.mouthAperture), 0)} fps`,
  ]
  const verdict = (status: CheckResult['status'], score: number, reasons: string[]): CheckResult => ({
    kind: 'sonar',
    status,
    score,
    reasons: [...reasons, ...measured],
  })

  // A client that can't run the landmarker is not a spoof; say so and move on.
  if (ev.mouthAperture.length < MIN_MOUTH_FRAMES) {
    return verdict('inconclusive', 0.5, ['no mouth landmarks in evidence'])
  }
  if (ev.doppler.length < MIN_DOPPLER_FRAMES) {
    return verdict('inconclusive', 0.5, ['too few doppler frames'])
  }

  // Only the span both series cover can be correlated.
  const from = Math.max(firstT(ev.doppler), firstT(ev.mouthAperture))
  const to = Math.min(lastT(ev.doppler), lastT(ev.mouthAperture))
  const coverage = (to - from) / challenge.durationMs
  measured.push(`overlap ${fmt((to - from) / 1000, 1)}s of ${challenge.durationMs / 1000}s`)
  if (!(coverage >= MIN_COVERAGE)) {
    return verdict('inconclusive', 0.5, ['audio and video barely overlap'])
  }
  // Timestamps are client-supplied; a window far longer than the one we issued
  // is malformed, and sizing the analysis grid from it would be reckless.
  if (coverage > MAX_COVERAGE) {
    return verdict('inconclusive', 0.5, ['timestamps span more than the issued window'])
  }

  const times = grid(from, to, GRID_HZ)
  const mouth = resample(
    ev.mouthAperture.map((s): Sample => ({ t: s.t, v: s.value })),
    times,
  )
  const energy = resample(
    ev.doppler.map((s): Sample => ({ t: s.t, v: s.energy })),
    times,
  )

  const swing = extent(mouth)
  measured.push(`mouth swing ${fmt(swing, 3)} of face height`)
  // Passive check: the window lands wherever the conversation happens to be,
  // so a still mouth usually means the candidate was listening. There is
  // nothing to correlate and nothing to hold against them.
  if (!(swing >= MIN_MOUTH_SWING)) {
    return verdict('inconclusive', 0.5, ['no speech in this window'])
  }

  // Doppler magnitude tracks speed, so compare it against mouth *speed*. Both
  // land on the half-step between grid points, which keeps them aligned.
  const mouthSpeed = mouth.slice(1).map((v, i) => Math.abs(v - mouth[i]!) * GRID_HZ)
  const echo = energy.slice(1).map((v, i) => (v + energy[i]!) / 2)

  const variation = variationCoefficient(echo)
  measured.push(`echo variation ${fmt(variation, 3)}`)

  const a = standardise(mouthSpeed)
  const b = standardise(echo)
  const minLag = Math.round((MIN_LAG_MS * GRID_HZ) / 1000)
  const maxLag = Math.round((MAX_LAG_MS * GRID_HZ) / 1000)
  const peak = a && b ? peakCrossCorrelation(a, b, minLag, maxLag) : null
  // Raw r is not comparable across runs: searching a range of lags and keeping
  // the best inflates it, and spiky echo series inflate it further. What
  // matters is how far the peak rises above what the same search finds on the
  // same data with its alignment destroyed.
  const chance = a && b ? chanceCorrelation(a, b, minLag, maxLag) : 0
  const excess = peak ? peak.r - chance : 0
  if (peak) {
    const lagMs = Math.round((peak.lagSamples * 1000) / GRID_HZ)
    measured.unshift(
      `doppler↔mouth r=${fmt(peak.r)} vs chance ${fmt(chance)} (excess ${fmt(excess)})` +
        ` at lag ${lagMs >= 0 ? '+' : ''}${lagMs}ms`,
    )
  }

  // A match this far above coincidence is self-proving: the echo tracked the
  // lips, so the probe reached the user whatever the SNR estimate claims.
  // Gating on SNR first would throw away a measurement that demonstrably
  // worked.
  if (peak && excess >= PASS_EXCESS) {
    return verdict('pass', scoreFor(excess), [])
  }

  // Past here the check did not match, and the question is whose fault that
  // is. Blaming the user requires confidence the probe actually reached them
  // AND that this measurement could have told the difference at all.
  if (chance > MAX_CHANCE) {
    return verdict('inconclusive', 0.5, [
      'too rhythmic to tell a real match from a coincidental one',
    ])
  }
  if (!(ev.carrierSnrDb >= MIN_CARRIER_SNR_DB)) {
    return verdict('inconclusive', 0.5, ["probe did not survive this device's speaker/mic path"])
  }
  if (!peak) {
    return verdict('fail', 0.1, ['one of the series is flat'])
  }
  if (!(variation >= MIN_DOPPLER_VARIATION)) {
    return verdict('fail', 0.1, ['echo is static while the video shows a moving mouth'])
  }
  return verdict('fail', scoreFor(excess), ['movement does not match the lips'])
}

/** Effective sample rate of a series, Hz. */
function rateHz(series: { t: number }[]): number {
  if (series.length < 2) return 0
  const span = lastT(series) - firstT(series)
  return span > 0 ? ((series.length - 1) * 1000) / span : 0
}

/** Monotone in excess so the aggregate score degrades smoothly, not in steps. */
function scoreFor(excess: number): number {
  return Math.min(1, Math.max(0, excess / (PASS_EXCESS * 2)))
}

// Reduced rather than spread: these series come from the client, and
// Math.min(...huge) overflows the stack.
function firstT(series: { t: number }[]): number {
  return series.reduce((min, s) => Math.min(min, s.t), Infinity)
}

function lastT(series: { t: number }[]): number {
  return series.reduce((max, s) => Math.max(max, s.t), -Infinity)
}

/** Peak-to-peak range of a series. */
function extent(xs: number[]): number {
  let min = Infinity
  let max = -Infinity
  for (const x of xs) {
    if (x < min) min = x
    if (x > max) max = x
  }
  return max - min
}

function fmt(x: number, digits = 2): string {
  return Number.isFinite(x) ? x.toFixed(digits) : 'n/a'
}
