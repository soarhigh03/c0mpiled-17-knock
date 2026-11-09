/**
 * Small DSP helpers for the correlation-based verifiers. Everything here runs
 * on client-supplied evidence, so nothing may assume well-formed input.
 */

export interface Sample {
  t: number
  v: number
}

/** Evenly spaced grid of `count` timestamps covering [from, to]. */
export function grid(from: number, to: number, rateHz: number): number[] {
  const count = Math.floor(((to - from) * rateHz) / 1000) + 1
  return Array.from({ length: Math.max(0, count) }, (_, i) => from + (i * 1000) / rateHz)
}

/** Linear interpolation onto `times`. Ends are held — never extrapolated. */
export function resample(samples: Sample[], times: number[]): number[] {
  if (samples.length === 0) return times.map(() => 0)
  const src = [...samples].sort((a, b) => a.t - b.t)

  let i = 0
  return times.map((t) => {
    while (i + 2 < src.length && src[i + 1]!.t <= t) i++
    const a = src[i]!
    const b = src[Math.min(i + 1, src.length - 1)]!
    const span = b.t - a.t
    if (span <= 0) return a.v
    const w = Math.min(1, Math.max(0, (t - a.t) / span))
    return a.v + (b.v - a.v) * w
  })
}

/** Mean 0, std 1. Null when the series is flat, i.e. there is nothing to correlate. */
export function standardise(xs: number[]): number[] | null {
  if (xs.length < 2) return null
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length
  const std = Math.sqrt(variance)
  if (!(std > 1e-9)) return null
  return xs.map((x) => (x - mean) / std)
}

/** Coefficient of variation; how much a non-negative series actually moves. */
export function variationCoefficient(xs: number[]): number {
  if (xs.length < 2) return 0
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length
  if (!(mean > 0)) return 0
  const variance = xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length
  return Math.sqrt(variance) / mean
}

export interface LaggedCorrelation {
  r: number
  /** Positive = `b` happens later than `a`, in samples. */
  lagSamples: number
}

/**
 * Peak cross-correlation of two standardised series over a lag range.
 * Only the positive peak is reported: an anti-correlated pair is not evidence
 * that the mouth drove the echo.
 */
export function peakCrossCorrelation(
  a: number[],
  b: number[],
  minLag: number,
  maxLag: number,
): LaggedCorrelation {
  let best: LaggedCorrelation = { r: 0, lagSamples: 0 }
  for (let lag = minLag; lag <= maxLag; lag++) {
    const from = Math.max(0, -lag)
    const to = Math.min(a.length, b.length - lag)
    const n = to - from
    if (n < 2) continue
    let sum = 0
    for (let i = from; i < to; i++) sum += a[i]! * b[i + lag]!
    const r = Math.min(1, Math.max(-1, sum / n))
    if (r > best.r) best = { r, lagSamples: lag }
  }
  return best
}

/** Rotations used to estimate the chance level. */
const ROTATIONS = 8

/**
 * What the same peak search is worth on data with no real time relationship.
 *
 * Rotating one series keeps its shape, its spikiness and its autocorrelation
 * but destroys its alignment with the other, so any peak the search still
 * finds is what coincidence alone buys. Searching N lags and keeping the
 * maximum inflates r on its own — the wider the search and the spikier the
 * series, the more it inflates — and without this baseline there is no way to
 * tell a real 0.3 from a coincidental one.
 */
export function chanceCorrelation(
  a: number[],
  b: number[],
  minLag: number,
  maxLag: number,
): number {
  const n = b.length
  // Keep rotations clear of the true alignment, or the "null" still contains
  // the signal we are trying to measure against.
  const guard = Math.abs(minLag) + Math.abs(maxLag) + 1
  const peaks: number[] = []
  for (let k = 1; k <= ROTATIONS; k++) {
    const shift = Math.round((k * n) / (ROTATIONS + 1))
    if (shift < guard || n - shift < guard) continue
    const rotated = [...b.slice(shift), ...b.slice(0, shift)]
    peaks.push(peakCrossCorrelation(a, rotated, minLag, maxLag).r)
  }
  return peaks.length > 0 ? peaks.reduce((s, x) => s + x, 0) / peaks.length : 0
}

/**
 * Peak partial correlation of `signal` with `target`, holding `control` fixed.
 *
 * The echo is one mixed number per frame, so a nodding head and a speaking
 * mouth both land in it and a plain correlation cannot say which one it saw.
 * Video can tell them apart, so the head's motion comes in as a control: this
 * asks whether the lips explain anything the head does not already account
 * for. `control` shares the video clock with `signal`, so only `target` is
 * lagged.
 */
export function peakPartialCorrelation(
  signal: number[],
  target: number[],
  control: number[],
  minLag: number,
  maxLag: number,
): LaggedCorrelation {
  let best: LaggedCorrelation = { r: 0, lagSamples: 0 }
  for (let lag = minLag; lag <= maxLag; lag++) {
    const from = Math.max(0, -lag)
    const to = Math.min(signal.length, control.length, target.length - lag)
    if (to - from < 2) continue
    const st = dot(signal, target, from, to, lag)
    const sc = dot(signal, control, from, to, 0)
    const ct = dot(control, target, from, to, lag)
    const denom = Math.sqrt((1 - sc * sc) * (1 - ct * ct))
    // Head motion that already explains the mouth (or the echo) completely
    // leaves nothing to attribute; report no evidence rather than divide by ~0.
    if (!(denom > 1e-3)) continue
    const r = Math.min(1, Math.max(-1, (st - sc * ct) / denom))
    if (r > best.r) best = { r, lagSamples: lag }
  }
  return best
}

/** Mean product over an overlap; the inputs are already standardised. */
function dot(a: number[], b: number[], from: number, to: number, lag: number): number {
  let sum = 0
  for (let i = from; i < to; i++) sum += a[i]! * b[i + lag]!
  return Math.min(1, Math.max(-1, sum / (to - from)))
}

/** `chanceCorrelation`, for the partial statistic. */
export function chancePartialCorrelation(
  signal: number[],
  target: number[],
  control: number[],
  minLag: number,
  maxLag: number,
): number {
  const n = target.length
  const guard = Math.abs(minLag) + Math.abs(maxLag) + 1
  const peaks: number[] = []
  for (let k = 1; k <= ROTATIONS; k++) {
    const shift = Math.round((k * n) / (ROTATIONS + 1))
    if (shift < guard || n - shift < guard) continue
    const rotated = [...target.slice(shift), ...target.slice(0, shift)]
    peaks.push(peakPartialCorrelation(signal, rotated, control, minLag, maxLag).r)
  }
  return peaks.length > 0 ? peaks.reduce((s, x) => s + x, 0) / peaks.length : 0
}
