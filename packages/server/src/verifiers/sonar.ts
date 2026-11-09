import type { CheckResult, SonarChallenge, SonarEvidence } from '@knock/shared'
import {
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
/** Lag search range. Covers capture/encode delay on both paths, either way round. */
const MAX_LAG_MS = 300
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
/** Mouth has to swing this much, as a fraction of face height. */
const MIN_MOUTH_SWING = 0.01
/** Correlation needed to call the two series the same event. */
const PASS_CORRELATION = 0.45

export function verifySonar(challenge: SonarChallenge, ev: SonarEvidence): CheckResult {
  const snr = `carrier SNR ${fmt(ev.carrierSnrDb)} dB`

  // Hardware first: without the carrier there is no measurement to judge.
  if (!(ev.carrierSnrDb >= MIN_CARRIER_SNR_DB)) {
    return result('inconclusive', 0.5, [
      `${snr} — probe did not survive this device's speaker/mic path`,
    ])
  }
  // A client that can't run the landmarker is not a spoof; say so and move on.
  if (ev.mouthAperture.length < MIN_MOUTH_FRAMES) {
    return result('inconclusive', 0.5, ['no mouth landmarks in evidence', snr])
  }
  if (ev.doppler.length < MIN_DOPPLER_FRAMES) {
    return result('inconclusive', 0.5, ['too few doppler frames', snr])
  }

  // Only the span both series cover can be correlated.
  const from = Math.max(firstT(ev.doppler), firstT(ev.mouthAperture))
  const to = Math.min(lastT(ev.doppler), lastT(ev.mouthAperture))
  const coverage = (to - from) / challenge.durationMs
  if (!(coverage >= MIN_COVERAGE)) {
    return result('inconclusive', 0.5, [
      `audio and video only overlap for ${Math.round((to - from) / 100) / 10}s of ${
        challenge.durationMs / 1000
      }s`,
      snr,
    ])
  }
  // Timestamps are client-supplied; a window far longer than the one we issued
  // is malformed, and sizing the analysis grid from it would be reckless.
  if (coverage > MAX_COVERAGE) {
    return result('inconclusive', 0.5, ['timestamps span more than the issued window', snr])
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
  if (!(swing >= MIN_MOUTH_SWING)) {
    return result('fail', 0.1, [`mouth never opened (swing ${fmt(swing, 3)} of face height)`, snr])
  }

  // Doppler magnitude tracks speed, so compare it against mouth *speed*. Both
  // land on the half-step between grid points, which keeps them aligned.
  const mouthSpeed = mouth.slice(1).map((v, i) => Math.abs(v - mouth[i]!) * GRID_HZ)
  const echo = energy.slice(1).map((v, i) => (v + energy[i]!) / 2)

  const variation = variationCoefficient(echo)
  if (!(variation >= MIN_DOPPLER_VARIATION)) {
    return result('fail', 0.1, [
      `echo is static (variation ${fmt(variation, 3)}) while the video shows a moving mouth`,
      snr,
    ])
  }

  const a = standardise(mouthSpeed)
  const b = standardise(echo)
  if (!a || !b) {
    return result('fail', 0.1, ['one of the series is flat', snr])
  }

  const maxLag = Math.round((MAX_LAG_MS * GRID_HZ) / 1000)
  const { r, lagSamples } = peakCrossCorrelation(a, b, maxLag)
  const lagMs = Math.round((lagSamples * 1000) / GRID_HZ)
  const detail = `doppler↔mouth r=${fmt(r)} at lag ${lagMs >= 0 ? '+' : ''}${lagMs}ms`

  return r >= PASS_CORRELATION
    ? result('pass', scoreFor(r), [detail, snr])
    : result('fail', scoreFor(r), [`${detail} — movement does not match the lips`, snr])
}

/** Monotone in r so the aggregate score degrades smoothly, not in steps. */
function scoreFor(r: number): number {
  return Math.min(1, Math.max(0, (r + 0.05) / 0.65))
}

function result(status: CheckResult['status'], score: number, reasons: string[]): CheckResult {
  return { kind: 'sonar', status, score, reasons }
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
