import type { SonarChallenge, SonarEvidence } from '@knock/shared'
import type { RunContext } from '../client.ts'
import {
  bandPeakDb,
  FFT_SIZE,
  FILL_MS,
  median,
  NO_CARRIER_DB,
  RAW_MIC,
  wait,
} from './audio.ts'
import {
  createMouthTracker,
  type FaceModelOptions,
  type HeadSample,
  type MouthSample,
  type MouthTracker,
} from './mouth.ts'
import {
  BAND_HIGH_HZ,
  BAND_LOW_HZ,
  BASEBAND_HZ,
  FRAME_HZ,
  SONAR_PROCESSOR_NAME,
  SONAR_WORKLET_SOURCE,
  type SonarFrameMessage,
} from './sonar-worklet.ts'

/** Carrier amplitude: loud enough to survive the room, still inaudible. */
const CARRIER_GAIN = 0.2
/** Ramp length at both ends; a hard gate would click audibly. */
const FADE_MS = 150
/** Time for the DC tracker to settle before the measured window opens. */
const WARMUP_MS = 400
/**
 * Extra settling before the window opens, on top of the DC warm-up: the face
 * landmarker's first inferences take hundreds of ms (shader compilation) and
 * belong outside the measurement.
 */
const LEAD_IN_MS = 1_200
/** Carrier SNR is sampled repeatedly and reduced to a median. */
const SNR_INTERVAL_MS = 500
/**
 * Guard band offset. Far enough out that mouth Doppler (tens of Hz) is not in
 * it, close enough that the device's frequency response is much the same.
 */
const GUARD_OFFSET_HZ = 400
const BASELINE_READS = 3
const BASELINE_GAP_MS = 60

export interface DopplerSample {
  /** ms since the probe window started, on the `performance.now()` clock. */
  t: number
  energy: number
}

export interface SonarProbeOptions {
  /** A `<video>` already playing the camera stream; frames are read from it. */
  video: HTMLVideoElement
  carrierHz: number
  durationMs: number
  /** Ends the probe early and returns whatever was collected. */
  signal?: AbortSignal
  faceModel?: FaceModelOptions
  /** Fired when the measured window opens. Nothing is asked of the user. */
  onReady?: () => void
  onDoppler?: (sample: DopplerSample) => void
  onMouth?: (sample: MouthSample) => void
  onCarrier?: (reading: CarrierReading) => void
}

export interface CarrierReading {
  /**
   * How far the carrier bin rose when the tone was switched on, dB. Measured
   * against the same bin in the silent room, so unlike a peak-vs-neighbours
   * estimate it carries no order-statistics bias: 0 dB really is "our tone
   * added nothing".
   */
  snrDb: number
  /**
   * Carrier bin over a guard band beside it, dB. A real tone towers over the
   * guard; broadband energy that merely lands in the demodulation band —
   * speech sibilance reaches past 19 kHz — lifts both together and scores
   * near 0. Diagnostic only; nothing judges on it yet.
   */
  tonalityDb: number
}

export interface SonarSignals {
  doppler: DopplerSample[]
  mouthAperture: MouthSample[]
  head: HeadSample[]
  carrierSnrDb: number
  sampleRate: number
}

/**
 * Run the probe and return the raw series. Exported for hardware bring-up
 * (see the Sonar Lab in apps/meet): a laptop whose speaker or microphone rolls
 * off before 19 kHz can't carry the challenge at all, and that is worth
 * knowing per machine before blaming the verifier.
 *
 * Nothing here judges anything — the server does that.
 */
export async function probeSonar(options: SonarProbeOptions): Promise<SonarSignals> {
  const doppler: DopplerSample[] = []
  const mouthAperture: MouthSample[] = []
  const head: HeadSample[] = []
  const snrReadings: number[] = []

  // Our own capture: the browser's echo canceller and noise suppressor exist
  // precisely to delete what we are trying to measure, and a call's microphone
  // track has them on.
  const mic = await navigator.mediaDevices.getUserMedia({ audio: RAW_MIC })
  // No forced sample rate: resampling the capture would smear the carrier.
  // A device that ends up below ~40 kHz can't carry it at all, which the SNR
  // reading reports rather than silently mis-measuring.
  const ac = new AudioContext()
  let tracker: MouthTracker | null = null
  let oscillator: OscillatorNode | undefined
  let snrTimer: ReturnType<typeof setInterval> | undefined

  try {
    // Checks run well after the click that started them, so the context can
    // come up suspended; without this the probe emits and records nothing.
    if (ac.state === 'suspended') await ac.resume()

    const moduleUrl = URL.createObjectURL(new Blob([SONAR_WORKLET_SOURCE], { type: 'text/javascript' }))
    try {
      await ac.audioWorklet.addModule(moduleUrl)
    } finally {
      URL.revokeObjectURL(moduleUrl)
    }

    // Loading the face model takes seconds; do it before the tone goes out.
    tracker = await createMouthTracker(options.video, options.faceModel)

    const analyser = new AnalyserNode(ac, { fftSize: FFT_SIZE, smoothingTimeConstant: 0 })
    const micSource = ac.createMediaStreamSource(mic)
    micSource.connect(analyser)

    // What the carrier bin reads in this room with our tone off. Everything
    // the SNR says later is relative to this, which is the only way the number
    // means "our tone arrived" rather than "this bin happens to be the loudest
    // of the nine I looked at".
    const spectrum = new Float32Array(analyser.frequencyBinCount)
    const binHz = ac.sampleRate / FFT_SIZE
    /** One snapshot, so the carrier and its guard band are read simultaneously. */
    const snapshot = () => {
      analyser.getFloatFrequencyData(spectrum)
      return {
        carrier: bandPeakDb(spectrum, binHz, options.carrierHz),
        guard: bandPeakDb(spectrum, binHz, options.carrierHz + GUARD_OFFSET_HZ),
      }
    }
    await wait(FILL_MS, options.signal)
    const ambient: number[] = []
    for (let i = 0; i < BASELINE_READS; i++) {
      const { carrier } = snapshot()
      if (carrier != null) ambient.push(carrier)
      await wait(BASELINE_GAP_MS, options.signal)
    }
    const ambientDb = ambient.length > 0 ? median(ambient) : NO_CARRIER_DB

    // --- transmit: one continuous tone, faded in and out.
    // TODO(meet): notch this out of the outgoing WebRTC audio so the far end
    // doesn't carry our probe into their own sonar window.
    const gain = new GainNode(ac, { gain: 0 })
    oscillator = new OscillatorNode(ac, { frequency: options.carrierHz })
    oscillator.connect(gain).connect(ac.destination)
    oscillator.start()
    gain.gain.setValueAtTime(0, ac.currentTime)
    gain.gain.linearRampToValueAtTime(CARRIER_GAIN, ac.currentTime + FADE_MS / 1000)

    // --- receive
    const decim = Math.max(1, Math.round(ac.sampleRate / BASEBAND_HZ))
    const basebandHz = ac.sampleRate / decim
    const demod = new AudioWorkletNode(ac, SONAR_PROCESSOR_NAME, {
      outputChannelCount: [1],
      processorOptions: {
        carrierHz: options.carrierHz,
        decim,
        frameLen: Math.max(1, Math.round(basebandHz / FRAME_HZ)),
        dcAlpha: Math.exp((-2 * Math.PI * BAND_LOW_HZ) / basebandHz),
        lpBeta: Math.exp((-2 * Math.PI * BAND_HIGH_HZ) / basebandHz),
      },
    })
    micSource.connect(demod)
    // The worklet emits silence, but a node the destination can't reach is
    // allowed to be culled from the rendering graph, so give it a muted sink.
    demod.connect(new GainNode(ac, { gain: 0 })).connect(ac.destination)

    await wait(WARMUP_MS, options.signal)

    // The window opens one lead-in from now. Both pipelines start immediately
    // and timestamp against that future instant, so everything they emit while
    // settling comes out negative and is dropped: the landmarker's first
    // inferences (shader compilation, hundreds of ms) and the tail of the DC
    // warm-up stay outside the measurement.
    const t0 = performance.now() + LEAD_IN_MS

    // Audio runs on its own clock. Anchor it to performance.now() once so the
    // Doppler series and the video series share a timebase; over a window this
    // short the two clocks don't drift enough to matter, and the verifier
    // searches for the residual lag anyway.
    const stamp = ac.getOutputTimestamp()
    const anchorContext = stamp.contextTime ?? ac.currentTime
    const anchorPerf = stamp.performanceTime ?? performance.now()
    const audioToElapsed = (sample: number) =>
      anchorPerf + (sample / ac.sampleRate - anchorContext) * 1000 - t0

    demod.port.onmessage = (event: MessageEvent<SonarFrameMessage>) => {
      const t = audioToElapsed(event.data.sample)
      if (t < 0) return
      const sample = { t, energy: event.data.rms }
      doppler.push(sample)
      options.onDoppler?.(sample)
    }

    tracker?.track(t0, (sample) => {
      if (sample.mouth.t < 0) return
      mouthAperture.push(sample.mouth)
      head.push(sample.head)
      options.onMouth?.(sample.mouth)
    })

    options.onReady?.()
    await wait(LEAD_IN_MS, options.signal)

    const readCarrier = () => {
      const { carrier, guard } = snapshot()
      if (carrier == null) return
      const reading: CarrierReading = {
        snrDb: carrier - ambientDb,
        tonalityDb: guard == null ? 0 : carrier - guard,
      }
      snrReadings.push(reading.snrDb)
      options.onCarrier?.(reading)
    }
    snrTimer = setInterval(readCarrier, SNR_INTERVAL_MS)
    readCarrier()

    await wait(options.durationMs, options.signal)

    gain.gain.cancelScheduledValues(ac.currentTime)
    gain.gain.setValueAtTime(gain.gain.value, ac.currentTime)
    gain.gain.linearRampToValueAtTime(0, ac.currentTime + FADE_MS / 1000)
    await wait(FADE_MS)
  } finally {
    if (snrTimer !== undefined) clearInterval(snrTimer)
    tracker?.stop()
    oscillator?.stop()
    for (const track of mic.getTracks()) track.stop()
    await ac.close()
  }

  return {
    doppler,
    mouthAperture,
    head,
    // Must stay finite: NaN/Infinity become null in JSON and the evidence
    // schema would reject the submission instead of letting the server call
    // the check inconclusive.
    carrierSnrDb: snrReadings.length > 0 ? median(snrReadings) : NO_CARRIER_DB,
    sampleRate: ac.sampleRate,
  }
}

/**
 * Emit the server's carrier, record the echo, and hand back the movement
 * energy next to the mouth aperture seen in video. The server decides whether
 * the two agree.
 *
 * Deliberately passive: nothing is shown and nothing is asked. The point of
 * this check is that it runs underneath a real conversation, and an interview
 * that stops to make the candidate recite something is a worse product.
 *
 * Natural speech is also the better stimulus. A scripted count is close to
 * periodic, and a periodic mouth lines up with a periodic echo at almost any
 * lag, which leaves the correlation unable to tell a real match from a
 * coincidence. Spontaneous speech — irregular pauses, varying rate, sentence
 * boundaries — carries the timing structure the correlation needs.
 */
export async function runSonar(challenge: SonarChallenge, ctx: RunContext): Promise<SonarEvidence> {
  const signals = await probeSonar({
    video: ctx.video,
    carrierHz: challenge.carrierHz,
    durationMs: challenge.durationMs,
  })
  return { kind: 'sonar', ...signals }
}
