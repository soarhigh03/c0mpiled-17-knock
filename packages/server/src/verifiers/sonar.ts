import type { CheckResult, SonarChallenge, SonarEvidence } from '@knock/shared'
import {
  chancePartialCorrelation,
  grid,
  peakPartialCorrelation,
  resample,
  standardise,
  variationCoefficient,
  type Sample,
} from './signal.ts'

/**
 * SonarGuard: is a physical body moving in front of this device?
 *
 * The near-ultrasonic echo only fluctuates if something is actually there to
 * reflect it. A video played into a virtual camera, or an AI avatar, shows a
 * face that moves while the room stays acoustically still — that mismatch is
 * what this catches.
 *
 * It deliberately does NOT claim the movement is the candidate's lips.
 * Measured on real hardware, a single continuous tone cannot support that: the
 * echo is one mixed number per frame, and a head is a far larger reflector
 * than a pair of lips, so ordinary head motion buries the lip signal. Lip
 * agreement is still computed and still raises the score when it is there, but
 * nothing fails for its absence. Separating reflectors by distance needs range
 * resolution, i.e. FMCW — see README.
 *
 * What this leaves open: an impostor who is physically present while a replay
 * drives the video passes this check. `light` is what covers that.
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
/**
 * How much the echo must fluctuate, relative to its own mean, for a body to be
 * there. Measured: a person moving naturally 0.95, sitting rigidly still 0.37,
 * a simulated empty room 0.11. PROVISIONAL at 0.20 — it needs a real replay
 * measured on real hardware, not a simulated one.
 */
const MIN_PRESENCE_VARIATION = 0.2
/** Mouth has to swing this much, as a fraction of face height, to be speech. */
const MIN_MOUTH_SWING = 0.01
/** Presence alone. Confident, but short of what lip agreement would buy. */
const PRESENCE_SCORE = 0.75
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

  // The verdict now rests entirely on the echo, so without a carrier there is
  // nothing to judge — unlike before, when a strong lip correlation could
  // vouch for the probe on its own.
  if (!(ev.carrierSnrDb >= MIN_CARRIER_SNR_DB)) {
    return verdict('inconclusive', 0.5, ["probe did not survive this device's speaker/mic path"])
  }
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

  // Doppler magnitude tracks speed, so compare it against mouth *speed*. Both
  // land on the half-step between grid points, which keeps them aligned.
  const mouthSpeed = mouth.slice(1).map((v, i) => Math.abs(v - mouth[i]!) * GRID_HZ)
  const echo = energy.slice(1).map((v, i) => (v + energy[i]!) / 2)

  // The verdict: did the room move? An empty room in front of a replayed
  // video keeps a steady echo however much the face on screen does.
  const variation = variationCoefficient(echo)
  measured.push(`echo variation ${fmt(variation, 3)}`)
  if (!(variation >= MIN_PRESENCE_VARIATION)) {
    return verdict('fail', 0.1, ['nothing physical is moving in front of the device'])
  }

  // Bonus, never a gate: when the echo demonstrably tracks the lips we know
  // more than presence, so the score goes higher. When it does not — which
  // ordinary head motion is enough to cause — presence still stands on its
  // own. See the file header for why this cannot be required.
  const lip = lipAgreement(ev, mouthSpeed, echo, times, swing)
  measured.push(lip.note)
  return verdict('pass', lip.confirmed ? 1 : PRESENCE_SCORE, [
    lip.confirmed ? 'a moving body, and the echo tracks the lips' : 'a moving body is present',
  ])
}

/**
 * Does the echo track the lips, beyond coincidence and beyond what head motion
 * already explains? Reported either way; only ever upgrades the verdict.
 */
function lipAgreement(
  ev: SonarEvidence,
  mouthSpeed: number[],
  echo: number[],
  times: number[],
  swing: number,
): { confirmed: boolean; note: string } {
  if (!(swing >= MIN_MOUTH_SWING)) return { confirmed: false, note: 'lips: no speech in window' }

  // Head motion from the same frames, as a control. Nodding and leaning put
  // far more energy into the echo than lips do, and the microphone cannot
  // separate them — but the camera can, so the question becomes whether the
  // lips explain anything the head does not already account for.
  const headSpeed = headSpeedOn(ev.head, times)
  const a = standardise(mouthSpeed)
  const b = standardise(echo)
  const c = headSpeed ? standardise(headSpeed) : null
  const control = c ?? new Array<number>(mouthSpeed.length).fill(0)
  if (!a || !b) return { confirmed: false, note: 'lips: series too flat to compare' }

  const minLag = Math.round((MIN_LAG_MS * GRID_HZ) / 1000)
  const maxLag = Math.round((MAX_LAG_MS * GRID_HZ) / 1000)
  const peak = peakPartialCorrelation(a, b, control, minLag, maxLag)
  const chance = chancePartialCorrelation(a, b, control, minLag, maxLag)
  const excess = peak.r - chance
  const lagMs = Math.round((peak.lagSamples * 1000) / GRID_HZ)
  const note =
    `lips: r=${fmt(peak.r)} vs chance ${fmt(chance)} (excess ${fmt(excess)})` +
    ` at lag ${lagMs >= 0 ? '+' : ''}${lagMs}ms${c ? ', head controlled' : ', head uncontrolled'}`

  // A chance level this high means the comparison could not have told a real
  // match from a coincidence, so its silence says nothing either way.
  if (chance > MAX_CHANCE) return { confirmed: false, note: `${note} — not discriminative` }
  return { confirmed: excess >= PASS_EXCESS, note }
}

/**
 * Head speed on the analysis grid: how fast the head is moving toward the mic
 * and across the frame. Scale changes dominate — that is radial motion, the
 * component that actually shifts the echo.
 */
function headSpeedOn(
  head: SonarEvidence['head'],
  times: number[],
): number[] | null {
  if (head.length < MIN_MOUTH_FRAMES) return null
  const scale = resample(head.map((h): Sample => ({ t: h.t, v: h.scale })), times)
  const x = resample(head.map((h): Sample => ({ t: h.t, v: h.x })), times)
  const y = resample(head.map((h): Sample => ({ t: h.t, v: h.y })), times)
  return scale
    .slice(1)
    .map((_, i) =>
      Math.hypot(scale[i + 1]! - scale[i]!, x[i + 1]! - x[i]!, y[i + 1]! - y[i]!) * GRID_HZ,
    )
}

/** Effective sample rate of a series, Hz. */
function rateHz(series: { t: number }[]): number {
  if (series.length < 2) return 0
  const span = lastT(series) - firstT(series)
  return span > 0 ? ((series.length - 1) * 1000) / span : 0
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
