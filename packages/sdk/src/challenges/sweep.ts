import {
  bandPeakDb,
  FFT_SIZE,
  FILL_MS,
  median,
  NO_CARRIER_DB,
  RAW_MIC,
  wait,
} from './audio.ts'

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

const DEFAULT_FROM_HZ = 14_000
const DEFAULT_TO_HZ = 22_000
const DEFAULT_STEP_HZ = 500
/** Matches the probe, so sweep results transfer directly to a real run. */
const DEFAULT_GAIN = 0.2
/** Readings per phase; the median rejects a passing bang or cough. */
const READS = 3
const READ_GAP_MS = 50
/** Tone rise time before measuring. */
const SETTLE_MS = 120

export interface SweepPoint {
  hz: number
  /** dB the carrier bin rose when the tone was switched on at this frequency. */
  arrivalDb: number
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

    const analyser = new AnalyserNode(ac, { fftSize: FFT_SIZE, smoothingTimeConstant: 0 })
    ac.createMediaStreamSource(mic).connect(analyser)

    const gain = new GainNode(ac, { gain: 0 })
    oscillator = new OscillatorNode(ac, { frequency: fromHz })
    oscillator.connect(gain).connect(ac.destination)
    oscillator.start()

    const spectrum = new Float32Array(analyser.frequencyBinCount)
    const binHz = ac.sampleRate / FFT_SIZE
    const read = async (hz: number) => {
      const levels: number[] = []
      for (let i = 0; i < READS; i++) {
        analyser.getFloatFrequencyData(spectrum)
        const db = bandPeakDb(spectrum, binHz, hz)
        if (db != null) levels.push(db)
        await wait(READ_GAP_MS, options.signal)
      }
      return levels.length > 0 ? median(levels) : NO_CARRIER_DB
    }

    for (let hz = fromHz; hz <= toHz; hz += stepHz) {
      if (options.signal?.aborted) break
      // Nyquist: a tone we cannot even represent is not a hardware finding.
      if (hz >= ac.sampleRate / 2) break

      gain.gain.setValueAtTime(0, ac.currentTime)
      oscillator.frequency.setValueAtTime(hz, ac.currentTime)
      await wait(FILL_MS, options.signal)
      const silent = await read(hz)

      gain.gain.setValueAtTime(options.gain ?? DEFAULT_GAIN, ac.currentTime)
      await wait(FILL_MS + SETTLE_MS, options.signal)
      const sounding = await read(hz)

      const point = { hz, arrivalDb: sounding - silent }
      points.push(point)
      options.onPoint?.(point)
    }

    gain.gain.setValueAtTime(0, ac.currentTime)
  } finally {
    oscillator?.stop()
    for (const track of mic.getTracks()) track.stop()
    await ac.close()
  }

  return points
}
