import type { CheckResult, LightChallenge, LightEvidence, LightPulse, LightRoi } from '@knock/shared'
import {
  chanceChannelCorrelation,
  firstT,
  fmt,
  grid,
  lastT,
  mean,
  median,
  peakChannelCorrelation,
  rateHz,
  resample,
  standardise,
  type ChannelPair,
  type Sample,
} from './signal.ts'

/**
 * Light panels frame the call window and flash a schedule only this session
 * knows. The question here is whether the face in the video reflected them.
 *
 * **What this claims**: the face on screen is a physical surface, in this room,
 * being lit by this screen, right now. A recording was lit by a different room
 * at a different time; a still image is not lit at all; a rendered face is lit
 * by whatever its model decided.
 *
 * **Why it exists next to sonar**: sonar asks whether a body is moving in front
 * of the device and deliberately stops there (docs/sonar.md §1). That leaves
 * the case where someone really is sitting there while the video is not of
 * them — a real-time face swap. This check is what covers it, and the way it
 * does is the `surround` region: a swap repaints the face and leaves the wall,
 * the hair and the shoulders alone, so the scene follows the panels while the
 * face does not. One frame, two regions, same exposure — that comparison is
 * the only part of this file a face swap has to defeat.
 *
 * **What it does not claim**: that a face which *does* follow the panels
 * belongs to the person it should. Light says the pixels are a real lit
 * surface; it says nothing about identity.
 *
 * Every threshold below is PROVISIONAL. They are placed from physics and from
 * the arithmetic of the statistic, not from a calibration set — see
 * docs/light.md §6 for what has to be measured to replace them.
 */

type Channel = 'r' | 'g' | 'b'
const CHANNELS: readonly Channel[] = ['r', 'g', 'b']
type Region = 'face' | 'surround'

/** The panels' idle state, and the baseline every pulse is scored against. */
const DARK = '#000000'

/** Analysis grid. Above the frame rate there is nothing more to resample. */
const GRID_HZ = 30

/**
 * Lag search. Light itself is instant; everything here is pipeline — display
 * latency, sensor integration, and with `callback` the whole camera delivery
 * path on top (docs/sonar.md §4.4).
 *
 * Wider than it looks like it should be, on purpose. The first run on real
 * hardware peaked at **+200ms on the face and +233ms on the scene, with
 * `captureTime`** — a MacBook's built-in camera, where tens of ms was the
 * guess. The ceiling was 250ms at the time, which put the scene's peak one
 * grid step from the edge, and a peak at the edge of a search is not a
 * measurement but a clipped one (the same thing the Sonar Lab's comment warns
 * about). It matters more here than it did there: both regions share the
 * pipeline, so a camera slower than the ceiling clips *both* and the verdict
 * becomes `fail` — a slow webcam accusing a real candidate of fraud, which is
 * the most expensive mistake this check can make.
 *
 * Every extra lag searched does raise the chance peak on its own. Measured
 * chance on that run was 0.05 against an excess of 0.88, so there was room.
 */
const LAG_MS: Record<LightEvidence['videoClock'], { min: number; max: number }> = {
  captureTime: { min: -50, max: 500 },
  callback: { min: 0, max: 700 },
}

/** Per-pulse render slop allowed once the one constant offset is removed. */
const MAX_RENDER_JITTER_MS = 120
/** Dead zone around each transition, so part-lit frames join neither window. */
const GUARD_MS = 60

/** Fraction of the issued window the frames have to actually cover. */
const MIN_COVERAGE = 0.6
/** Upper bound on the same, to reject nonsense timestamps. */
const MAX_COVERAGE = 2
const MIN_FRAMES = 40
/** Pulses that must have enough frames in and around them to be measured. */
const MIN_PULSES_MEASURED = 4
/**
 * Frames a pulse needs inside it before its response is worth a standard
 * error. Two would let a 9 fps landmarker reach a verdict off one frame pair
 * per pulse, which is not a measurement.
 */
const MIN_PULSE_FRAMES = 3
/** Of the pulses that could be measured, how many have to have responded. */
const MIN_PULSE_AGREEMENT = 0.6

/** Above this the region is at the top of the range and cannot get brighter. */
const MAX_CLIPPED = 0.2
/** Mean level below which a region is in the sensor's noise floor. */
const MIN_LEVEL = 8
/**
 * Scene level above which the panels cannot be expected to compete with
 * ambient light. Camera levels are the only photometry available here, and a
 * sunlit room pins the sensor high even after exposure control has done its
 * work. A session this bright gets `inconclusive`, never `fail`: a window with
 * the sun behind it is not evidence of a spoof.
 */
const BRIGHT_SCENE_LEVEL = 200

/**
 * How far above coincidence the correlation must rise to call a region lit by
 * the panels. Simulated: a live face reaches 0.55–0.92, a replay 0.08–0.10.
 * PROVISIONAL — simulated, see docs/light.md §6.
 */
const PASS_EXCESS = 0.3
/**
 * Below this a region is at chance: whatever is on screen there is not being
 * lit by the panels at all.
 *
 * Deliberately a separate number from PASS_EXCESS even though both measure the
 * same statistic. One licenses a `pass` and wants to be high; the other
 * licenses a `fail` — the face-swap verdict — and wants to be low. Sharing one
 * threshold would mean every adjustment for safety on one side was an
 * adjustment against safety on the other. Between the two the honest answer is
 * that we could not tell.
 */
const CHANCE_EXCESS = 0.15
/**
 * Chance above this and the comparison could not have separated a real
 * reflection from a coincidence, so its silence says nothing either way.
 */
const MAX_CHANCE = 0.5
/**
 * Response depth as a fraction of the region's own level. A border ring is
 * roughly a quarter of the screen's flux against a room's worth of ambient
 * light, so a few percent is what a genuine reflection looks like and 1% is
 * the floor at which the statistic is worth believing. PROVISIONAL — the most
 * load-bearing number in this file.
 */
const MIN_DEPTH = 0.01
/** Standard errors a single pulse's response must clear to count. */
const PULSE_SIGMA = 3
/**
 * Floor on the noise estimate, in camera levels. A replayed still frame has
 * *no* frame-to-frame variation, which would make any rounding difference look
 * like a significant response.
 */
const MIN_NOISE_LEVELS = 0.1
/** Face and scene are lit by one flash; their lags should agree this closely. */
const MAX_LAG_GAP_MS = 120

/** The face responded, but there was nothing usable around it to cross-check. */
const FACE_ONLY_SCORE = 0.85

interface RegionAnalysis {
  /** Mean level over the run, averaged over the channels. */
  level: number
  clipped: number
  usable: boolean
  r: number
  chance: number
  excess: number
  lagMs: number
  /** Median per-pulse response, as a fraction of the region's own level. */
  depth: number
  responded: number
  /** Pulses that had enough frames in and around them to be measured. */
  pulses: number
  live: boolean
}

export function verifyLight(challenge: LightChallenge, ev: LightEvidence): CheckResult {
  // Every verdict carries its measurements. A light failure is otherwise
  // indistinguishable from a bright room, a slow landmarker, or a camera whose
  // exposure control ate the flash.
  const measured: string[] = []
  const verdict = (status: CheckResult['status'], score: number, reasons: string[]): CheckResult => ({
    kind: 'light',
    status,
    score,
    reasons: [...reasons, ...measured],
  })

  if (ev.frames.length === 0) {
    return verdict('inconclusive', 0.5, ['no face landmarks in evidence'])
  }
  measured.push(
    `${ev.frames.length} frames @ ${fmt(rateHz(ev.frames), 0)} fps on the ${ev.videoClock} clock`,
  )
  if (ev.cameraModes) {
    measured.push(
      `camera exposure ${ev.cameraModes.exposure ?? 'unknown'}, white balance ${ev.cameraModes.whiteBalance ?? 'unknown'}`,
    )
  }
  if (ev.frames.length < MIN_FRAMES) {
    return verdict('inconclusive', 0.5, ['too few video frames'])
  }

  // The template comes from the challenge, so this is what ties it to the
  // frames: it recovers the single offset between the client's clock and the
  // schedule, and refuses evidence whose pulses wandered individually.
  const render = checkRender(challenge, ev.emissions)
  if ('reason' in render) return verdict('inconclusive', 0.5, [render.reason])
  measured.push(
    `panels rendered ${fmt(render.offsetMs, 0)}ms off schedule, pulse jitter ±${fmt(render.jitterMs, 0)}ms`,
  )

  const from = firstT(ev.frames)
  const to = lastT(ev.frames)
  const coverage = (to - from) / challenge.durationMs
  measured.push(`frames cover ${fmt((to - from) / 1000, 1)}s of ${challenge.durationMs / 1000}s`)
  if (!(coverage >= MIN_COVERAGE)) {
    return verdict('inconclusive', 0.5, ['the frames cover too little of the run'])
  }
  // Timestamps are client-supplied; a window far longer than the one we issued
  // is malformed, and sizing an analysis grid from it would be reckless.
  if (coverage > MAX_COVERAGE) {
    return verdict('inconclusive', 0.5, ['timestamps span more than the issued window'])
  }

  const times = grid(from, to, GRID_HZ)
  const lag = LAG_MS[ev.videoClock]
  const face = analyse('face', challenge, ev, render.offsetMs, times, lag)
  const surround = analyse('surround', challenge, ev, render.offsetMs, times, lag)
  measured.push(describe('face', face), describe('surround', surround))

  if (!face.usable) {
    return verdict('inconclusive', 0.5, [
      face.clipped > MAX_CLIPPED
        ? 'the face is over-exposed, so nothing we add can show up on it'
        : 'the face is too dark to measure a reflection on',
    ])
  }
  // A slow landmarker leaves the pulses with too few frames either side to
  // compare. That is a client limitation, not a spoof.
  if (face.pulses < MIN_PULSES_MEASURED) {
    return verdict('inconclusive', 0.5, ['too few frames inside the pulses to measure a response'])
  }
  if (face.chance > MAX_CHANCE) {
    return verdict('inconclusive', 0.5, [
      'the comparison could not separate a real reflection from a coincidence',
    ])
  }

  if (face.live) {
    if (!surround.live) {
      // Normal and common: the band outside the head is often a wall far
      // enough away that the inverse square law finishes it off.
      return verdict('pass', FACE_ONLY_SCORE, [
        'the face follows the panels; nothing usable around it to cross-check',
      ])
    }
    const lagGap = Math.abs(face.lagMs - surround.lagMs)
    measured.push(`face/scene lag gap ${fmt(lagGap, 0)}ms`)
    if (lagGap > MAX_LAG_GAP_MS) {
      // One flash lights both regions at once. A face that answers it on a
      // different schedule than the wall behind it has something in the path.
      return verdict('pass', FACE_ONLY_SCORE, [
        'the face follows the panels, but not on the same schedule as the scene around it',
      ])
    }
    return verdict('pass', 1, ['the face and the scene around it follow the panels together'])
  }

  if (surround.live) {
    // The scene is lit by the panels, so the panels had the authority to light
    // the face too. What separates a rendered face from a genuine but faint
    // one is the correlation, not the amplitude: a model shades the face on
    // its own schedule and lands near chance, while a face that is merely far
    // from the screen still tracks the panels — it just does not swing far
    // enough to call it. Comparing depths instead would be worse: depth is
    // relative to each region's own level, and a dark neutral wall shows
    // roughly twice the depth of reddish skin under identical light, so the
    // ratio carries a material term that has nothing to do with liveness.
    if (face.excess < CHANCE_EXCESS) {
      return verdict('fail', 0.1, [
        'the scene is lit by the panels and the face is not — the face is being rendered',
      ])
    }
    // A model that does reproduce the flash faithfully, in color and on time,
    // is indistinguishable here from a real face too far from the screen to
    // swing much. Saying so is the honest outcome; see docs/light.md §5.
    return verdict('inconclusive', 0.5, [
      'the face answers the panels, but too faintly to confirm against the scene',
    ])
  }

  if (Math.max(face.level, surround.level) >= BRIGHT_SCENE_LEVEL) {
    return verdict('inconclusive', 0.5, ['ambient light swamps the panels'])
  }
  if (Math.max(face.depth, surround.depth) >= MIN_DEPTH) {
    // Something in frame did change, on roughly the right beat, without the
    // panels' colors in it. That is what a replay with its own flicker looks
    // like, and the distinction is the whole reason the correlation runs on
    // chromatic residuals — see chromatic().
    return verdict('fail', 0.15, [
      "the frame changes brightness but not in the panels' colors — this screen is not what is lighting it",
    ])
  }
  return verdict('fail', 0.2, ['nothing in frame responded to the panels'])
}

/**
 * Did the panels render the schedule we issued?
 *
 * Without this a client could choose emission times that happen to fit a
 * replayed video's own flicker and hand us a template built around them. The
 * colors have to match in order, and once the median offset is removed — that
 * is real, it is the client clock against ours, and the lag search would have
 * absorbed it anyway — no individual pulse may have moved more than render
 * jitter.
 */
function checkRender(
  challenge: LightChallenge,
  emissions: LightEvidence['emissions'],
): { offsetMs: number; jitterMs: number } | { reason: string } {
  const sorted = [...emissions].sort((a, b) => a.t - b.t)
  const lit = sorted.filter((e) => hex(e.color) !== DARK)
  if (lit.length !== challenge.pulses.length) {
    return { reason: `panels rendered ${lit.length} of ${challenge.pulses.length} pulses` }
  }
  if (lit.some((e, i) => hex(e.color) !== hex(challenge.pulses[i]!.color))) {
    return { reason: 'the panels did not render the issued colors' }
  }

  const offsets = lit.map((e, i) => e.t - challenge.pulses[i]!.atMs)
  const offsetMs = median(offsets)
  const jitterMs = offsets.reduce((max, o) => Math.max(max, Math.abs(o - offsetMs)), 0)
  if (jitterMs > MAX_RENDER_JITTER_MS) {
    return { reason: 'panel onsets drifted from the issued schedule' }
  }

  // A panel left on would wipe out the baseline the next pulse is scored
  // against, so the hold is a receipt too.
  for (const [i, pulse] of challenge.pulses.entries()) {
    const dark = sorted.find((e) => e.t > lit[i]!.t && hex(e.color) === DARK)
    if (!dark) return { reason: 'the panels never went dark again after a pulse' }
    if (Math.abs(dark.t - lit[i]!.t - pulse.holdMs) > MAX_RENDER_JITTER_MS) {
      return { reason: 'panel hold times did not match the issued schedule' }
    }
  }
  return { offsetMs, jitterMs }
}

function analyse(
  region: Region,
  challenge: LightChallenge,
  ev: LightEvidence,
  offsetMs: number,
  times: number[],
  lag: { min: number; max: number },
): RegionAnalysis {
  const rois = ev.frames.map((f) => f[region])
  const level = mean(rois.map((roi) => (roi.r + roi.g + roi.b) / 3))
  const clipped = mean(rois.map((roi) => roi.clipped))
  const empty: RegionAnalysis = {
    level,
    clipped,
    usable: false,
    r: 0,
    chance: 0,
    excess: 0,
    lagMs: 0,
    depth: 0,
    responded: 0,
    pulses: 0,
    live: false,
  }
  if (!(clipped <= MAX_CLIPPED) || !(level >= MIN_LEVEL)) return empty

  // One correlation per channel against its own template, all sharing a lag —
  // on color, not on level. See chromaticity() for why the raw levels cannot
  // answer the question this check is asking.
  const expected = chromaticDrive(CHANNELS.map((c) => template(challenge, offsetMs, times, c)))
  const observed = chromaticity(
    CHANNELS.map((c) =>
      resample(
        ev.frames.map((f): Sample => ({ t: f.t, v: f[region][c] })),
        times,
      ),
    ),
  )
  // A channel the schedule never varies in, or a measured series that never
  // moves — which is what a frozen video gives — carries no information.
  const pairs: ChannelPair[] = []
  for (const [i] of CHANNELS.entries()) {
    const a = standardise(expected[i]!)
    const b = standardise(observed[i]!)
    if (a && b) pairs.push({ a, b })
  }
  const peak = peakChannelCorrelation(pairs, lagSamples(lag.min), lagSamples(lag.max))
  const chance = chanceChannelCorrelation(pairs, lagSamples(lag.min), lagSamples(lag.max))
  const lagMs = (peak.lagSamples * 1000) / GRID_HZ

  const responses = challenge.pulses
    .map((pulse) => pulseResponse(pulse, ev.frames, region, offsetMs + lagMs))
    .filter((r): r is PulseResponse => r !== null)
  const depth = responses.length > 0 ? median(responses.map((r) => r.depth)) : 0
  const responded = responses.filter((r) => r.responded).length
  const excess = peak.r - chance

  return {
    level,
    clipped,
    usable: true,
    r: peak.r,
    chance,
    excess,
    lagMs,
    depth,
    responded,
    pulses: responses.length,
    live:
      chance <= MAX_CHANCE &&
      excess >= PASS_EXCESS &&
      depth >= MIN_DEPTH &&
      responses.length >= MIN_PULSES_MEASURED &&
      responded >= Math.ceil(responses.length * MIN_PULSE_AGREEMENT),
  }
}

/**
 * Each channel's share of the frame's total, sample by sample.
 *
 * This is the chromatic test, and it has to be done explicitly rather than
 * trusted to fall out of per-channel correlation. Each of r, g and b is lit in
 * three or four of the six pulses, so the three raw templates share most of
 * their timing structure, and anything that merely brightens the whole frame
 * at roughly the right moments scores on all three at once — a simulated
 * replay with a 1 Hz grey flicker of its own passed that version of this
 * check.
 *
 * Subtracting the frame's mean level is *not* enough either. Skin is reddish,
 * so a neutral gain change scales its residual along its own hue — `level_c =
 * base_c · s` keeps `level_c − mean(level)` pointing the same way and growing
 * with `s`. Measured on a simulated replay with nothing but slow brightness
 * drift, that leaked r = 0.41 against the reddish pulses. A ratio is invariant
 * to `s` exactly, which is the property worth having: a lamp, a bright slide
 * at the far end, the camera's own gain stepping and content drift all scale
 * the channels together and move this not at all.
 *
 * The cost is real. Shares are differences of already small deltas, so the
 * noise roughly doubles, and a white pulse moves them barely at all — which is
 * why the palette draws six *distinct* colors (challenges.ts) and why depth is
 * kept as a separate measurement. This statistic answers "was it this screen",
 * not "was it bright".
 */
function chromaticity(channels: number[][]): number[][] {
  const [r, g, b] = channels as [number[], number[], number[]]
  const total = r.map((_, i) => r[i]! + g[i]! + b[i]!)
  return channels.map((series) => series.map((v, i) => (total[i]! > 0 ? v / total[i]! : 0)))
}

/**
 * Which channel a pulse pushes up relative to the others, and how hard: the
 * drive minus its own mean, zero whenever the panels are dark.
 *
 * Not the same transform as `chromaticity`, and deliberately so. The measured
 * side has to be scale-free because the things that corrupt it are gains; the
 * template side has no gain to remove, and a share of zero light is not a
 * number. What the two have in common is that both are a direction in color
 * weighted by strength, which is all a correlation needs.
 */
function chromaticDrive(channels: number[][]): number[][] {
  const [r, g, b] = channels as [number[], number[], number[]]
  const mid = r.map((_, i) => (r[i]! + g[i]! + b[i]!) / 3)
  return channels.map((series) => series.map((v, i) => v - mid[i]!))
}

/**
 * Expected panel output on the analysis grid, 0–1 per channel.
 *
 * Each grid point holds the fraction of its own interval during which the
 * pulse was lit, not a hard 0/1 step. The camera integrates over its exposure
 * the same way, so a pulse edge that falls mid-frame comes out part-height in
 * the template too instead of costing correlation for being honest.
 */
function template(
  challenge: LightChallenge,
  offsetMs: number,
  times: number[],
  channel: Channel,
): number[] {
  const step = 1000 / GRID_HZ
  return times.map((t) => {
    let sum = 0
    for (const pulse of challenge.pulses) {
      const on = pulse.atMs + offsetMs
      const overlap = Math.min(t + step, on + pulse.holdMs) - Math.max(t, on)
      if (overlap > 0) sum += (overlap / step) * (channelOf(pulse.color, channel) / 255)
    }
    return sum
  })
}

interface PulseResponse {
  /** Response along the pulse's own color, as a fraction of the dark level. */
  depth: number
  responded: boolean
}

/**
 * One pulse, in the region's own units: how far it moved along the pulse's
 * color direction compared with the dark frames either side of it.
 *
 * The projection is what stops this being a brightness detector. A pure red
 * pulse should move red and leave green and blue where they were, and the dot
 * product with the pulse's unit color rewards exactly that shape; a lamp
 * switching on somewhere moves all three and projects weakly onto any
 * saturated color.
 *
 * Returns null when there were not enough frames in or around the pulse — too
 * few frames is something to report, not something to score.
 */
function pulseResponse(
  pulse: LightPulse,
  frames: LightEvidence['frames'],
  region: Region,
  shiftMs: number,
): PulseResponse | null {
  const unit = unitColor(pulse.color)
  const start = pulse.atMs + shiftMs
  const end = start + pulse.holdMs
  const project = (roi: LightRoi) => roi.r * unit.r + roi.g * unit.g + roi.b * unit.b
  const inWindow = (lo: number, hi: number) =>
    frames.filter((f) => f.t >= lo && f.t < hi).map((f) => project(f[region]))

  const on = inWindow(start + GUARD_MS, end)
  // Both sides, so a slow drift in the room averages out of the baseline
  // instead of being charged to the pulse.
  const off = [
    ...inWindow(start - GUARD_MS - pulse.holdMs, start - GUARD_MS),
    ...inWindow(end + GUARD_MS, end + GUARD_MS + pulse.holdMs),
  ]
  if (on.length < MIN_PULSE_FRAMES || off.length < MIN_PULSE_FRAMES) return null

  const delta = mean(on) - mean(off)
  const pooled = Math.sqrt(
    ((on.length - 1) * variance(on) + (off.length - 1) * variance(off)) /
      (on.length + off.length - 2),
  )
  const noise = Math.max(pooled * Math.sqrt(1 / on.length + 1 / off.length), MIN_NOISE_LEVELS)
  const baseline = mean(off)
  return {
    depth: baseline > 0 ? delta / baseline : 0,
    responded: delta > PULSE_SIGMA * noise,
  }
}

function describe(name: string, a: RegionAnalysis): string {
  if (!a.usable) {
    return `${name}: unusable (level ${fmt(a.level, 0)}, clipped ${fmt(a.clipped * 100, 0)}%)`
  }
  return (
    `${name}: r=${fmt(a.r)} vs chance ${fmt(a.chance)} (excess ${fmt(a.excess)})` +
    ` at lag ${a.lagMs >= 0 ? '+' : ''}${fmt(a.lagMs, 0)}ms,` +
    ` depth ${fmt(a.depth * 100, 2)}%, ${a.responded}/${a.pulses} pulses,` +
    ` level ${fmt(a.level, 0)}, clipped ${fmt(a.clipped * 100, 0)}%`
  )
}

function lagSamples(ms: number): number {
  return Math.round((ms * GRID_HZ) / 1000)
}

function variance(xs: number[]): number {
  const m = mean(xs)
  return mean(xs.map((x) => (x - m) ** 2))
}

function hex(color: string): string {
  return color.toLowerCase()
}

function channelOf(color: string, channel: Channel): number {
  const at = channel === 'r' ? 1 : channel === 'g' ? 3 : 5
  return Number.parseInt(color.slice(at, at + 2), 16)
}

/** The pulse color as a unit vector, so the projection is a direction test. */
function unitColor(color: string): Record<Channel, number> {
  const raw = { r: channelOf(color, 'r'), g: channelOf(color, 'g'), b: channelOf(color, 'b') }
  const norm = Math.hypot(raw.r, raw.g, raw.b)
  if (!(norm > 0)) return { r: 0, g: 0, b: 0 }
  return { r: raw.r / norm, g: raw.g / norm, b: raw.b / norm }
}
