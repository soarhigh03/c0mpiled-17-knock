import { bandPeakDb, FILL_MS, median, RAW_MIC, wait } from './audio.ts'

/**
 * Measures which carrier frequencies actually make the round trip out of this
 * machine's speaker and back into its microphone.
 *
 * Laptops vary enormously up here: some carry 20 kHz fine, others are already
 * dead by 18 kHz, and the sonar check is meaningless on a frequency the
 * hardware cannot reproduce. Rather than guessing one value at a time, step
 * through the band and read the arrival at each.
 *
 * Each step is measured against its own silent baseline at the same bin, so
 * the result is "how much did our tone add here", not "how loud is this bin" —
 * the latter says more about room noise than about the speaker.
 */

/**
 * Starts above the audible band. Sweeping down into 14–17 kHz is genuinely
 * unpleasant at probe volume, and a carrier down there could never be used
 * anyway — callers that need it as a dead-output-path control pass it in.
 */
const DEFAULT_FROM_HZ = 17_500
const DEFAULT_TO_HZ = 22_000
const DEFAULT_STEP_HZ = 500
/** Matches the probe, so sweep results transfer directly to a real run. */
const DEFAULT_GAIN = 0.2
/**
 * Coarser than the probe's analyser: we only need to see whether a tone is
 * present, and a shorter window means a shorter settle, which keeps the whole
 * sweep inside the time a room stays quiet.
 */
const SWEEP_FFT_SIZE = 4096
/**
 * On/off pairs per frequency. One pair is hostage to whatever happened in the
 * room between its two reads — a chair, a voice, a door. Interleaving several
 * and differencing the medians rejects drift that a single before/after
 * cannot, which is the whole reason this is not one measurement.
 */
const CYCLES = 3
/** Must exceed the analyser window so a read sees only the new state. */
const SETTLE_MS = 140
/** Short ramp: gating a tone hard clicks, and a click is broadband. */
const RAMP_MS = 20

export interface SweepPoint {
  hz: number
  /** dB the carrier bin rose when the tone was switched on at this frequency. */
  arrivalDb: number
  /**
   * Spread of the silent readings at this frequency — how much the room moved
   * on its own. An arrival that does not clear it is not a measurement.
   */
  noiseDb: number
}

export interface SweepOptions {
  fromHz?: number
  toHz?: number
  stepHz?: number
  /** Output amplitude, 0–1. Defaults to the probe's own carrier gain. */
  gain?: number
  signal?: AbortSignal
  /** Called per step, so a UI can fill in as it goes. */
  onPoint?: (point: SweepPoint) => void
}

export async function sweepCarrierResponse(options: SweepOptions = {}): Promise<SweepPoint[]> {
  const fromHz = options.fromHz ?? DEFAULT_FROM_HZ
  const toHz = options.toHz ?? DEFAULT_TO_HZ
  const stepHz = options.stepHz ?? DEFAULT_STEP_HZ
  const points: SweepPoint[] = []

  const mic = await navigator.mediaDevices.getUserMedia({ audio: RAW_MIC })
  const ac = new AudioContext()
  let oscillator: OscillatorNode | undefined

  try {
    if (ac.state === 'suspended') await ac.resume()

    const analyser = new AnalyserNode(ac, { fftSize: SWEEP_FFT_SIZE, smoothingTimeConstant: 0 })
    ac.createMediaStreamSource(mic).connect(analyser)

    const gain = new GainNode(ac, { gain: 0 })
    oscillator = new OscillatorNode(ac, { frequency: fromHz })
    oscillator.connect(gain).connect(ac.destination)
    oscillator.start()

    const spectrum = new Float32Array(analyser.frequencyBinCount)
    const binHz = ac.sampleRate / SWEEP_FFT_SIZE
    const level = options.gain ?? DEFAULT_GAIN

    /** Ramp to `to`, let the analyser window refill, then read the bin. */
    const settleAndRead = async (hz: number, to: number) => {
      gain.gain.linearRampToValueAtTime(to, ac.currentTime + RAMP_MS / 1000)
      await wait(SETTLE_MS, options.signal)
      analyser.getFloatFrequencyData(spectrum)
      return bandPeakDb(spectrum, binHz, hz)
    }

    // Let the first analyser window fill, then throw one read away: a capture
    // that has only just started still has digital silence in the window, and
    // the half-empty FFT that produces would poison the first baseline.
    await wait(FILL_MS, options.signal)
    await settleAndRead(fromHz, 0)

    for (let hz = fromHz; hz <= toHz; hz += stepHz) {
      if (options.signal?.aborted) break
      // Nyquist: a tone we cannot even represent is not a hardware finding.
      if (hz >= ac.sampleRate / 2) break
      oscillator.frequency.setValueAtTime(hz, ac.currentTime)

      const off: number[] = []
      const on: number[] = []
      for (let cycle = 0; cycle < CYCLES; cycle++) {
        const silent = await settleAndRead(hz, 0)
        if (silent != null) off.push(silent)
        const sounding = await settleAndRead(hz, level)
        if (sounding != null) on.push(sounding)
      }

      // Infinite noise marks a frequency we failed to measure at all, so it
      // can never read as a clean result downstream.
      const measured = on.length > 0 && off.length > 1
      const point: SweepPoint = {
        hz,
        arrivalDb: measured ? median(on) - median(off) : 0,
        noiseDb: measured ? Math.max(...off) - Math.min(...off) : Infinity,
      }
      points.push(point)
      options.onPoint?.(point)
    }

    gain.gain.linearRampToValueAtTime(0, ac.currentTime + RAMP_MS / 1000)
  } finally {
    oscillator?.stop()
    for (const track of mic.getTracks()) track.stop()
    await ac.close()
  }

  return points
}
