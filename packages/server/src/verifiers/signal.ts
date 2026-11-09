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
 * Peak cross-correlation of two standardised series over ±`maxLag` samples.
 * Only the positive peak is reported: an anti-correlated pair is not evidence
 * that the mouth drove the echo.
 */
export function peakCrossCorrelation(a: number[], b: number[], maxLag: number): LaggedCorrelation {
  let best: LaggedCorrelation = { r: 0, lagSamples: 0 }
  for (let lag = -maxLag; lag <= maxLag; lag++) {
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
