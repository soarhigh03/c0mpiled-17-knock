/**
 * Spectrum helpers for the sonar probe and the sweep, plus `wait`, which every
 * check's run loop needs.
 */

/** 48 kHz / 8192 ≈ 5.9 Hz bins: fine enough to resolve a pure tone. */
export const FFT_SIZE = 8192
/** Half-width of a tone search, in bins; covers a tone sitting off-centre. */
export const PEAK_BINS = 4
/** Reported when the spectrum never showed anything measurable (e.g. dead mic). */
export const NO_CARRIER_DB = -120
/** The analyser needs a full FFT of audio before its first read means anything. */
export const FILL_MS = 250

/** Microphone constraints the probe depends on; the browser's cleanup would
 *  delete exactly the near-ultrasonic echo we are trying to measure. */
export const RAW_MIC: MediaTrackConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
  channelCount: 1,
}

/**
 * Strongest bin within ±PEAK_BINS of `hz`, dBFS, or null when the spectrum has
 * nothing usable there. Only meaningful compared against another reading —
 * the max of several bins sits above their median even in pure noise.
 */
export function bandPeakDb(spectrum: Float32Array, binHz: number, hz: number): number | null {
  const centre = Math.round(hz / binHz)
  const bins = finiteBins(spectrum, centre - PEAK_BINS, centre + PEAK_BINS)
  return bins.length > 0 ? Math.max(...bins) : null
}

/** Silent bins read as -Infinity, which would poison a peak or a median. */
export function finiteBins(spectrum: Float32Array, from: number, to: number): number[] {
  const out: number[] = []
  for (let i = Math.max(0, from); i <= Math.min(spectrum.length - 1, to); i++) {
    const db = spectrum[i]!
    if (Number.isFinite(db)) out.push(db)
  }
  return out
}

export function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** Resolves on timeout *or* abort: aborting ends a measurement, it isn't an error. */
export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}
