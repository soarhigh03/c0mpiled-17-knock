import type { SonarChallenge, SonarEvidence } from '@knock/shared'
import type { RunContext } from '../client.ts'
import { createMouthTracker, type FaceModelOptions, type MouthSample, type MouthTracker } from './mouth.ts'
import {
  BASEBAND_HZ,
  DC_CORNER_HZ,
  FRAME_HZ,
  SONAR_PROCESSOR_NAME,
  SONAR_WORKLET_SOURCE,
  type SonarFrameMessage,
} from './sonar-worklet.ts'

/** What the user has to do for the probe to see anything. */
export const SONAR_PROMPT = '1부터 10까지 소리 내어 세어주세요'
const SONAR_PREPARING = '마이크와 얼굴 추적을 준비하고 있습니다…'

/** Carrier amplitude: loud enough to survive the room, still inaudible. */
const CARRIER_GAIN = 0.2
/** Ramp length at both ends; a hard gate would click audibly. */
const FADE_MS = 150
/** Time for the DC tracker to settle before the measured window opens. */
const WARMUP_MS = 400
/**
 * Grace period between showing the prompt and opening the window. Reading the
 * prompt, drawing breath and the first syllable all land in here. Inside the
 * window they would be a second or more of a still mouth — usually next to a
 * shifting posture, i.e. movement the lips don't explain — which drags the
 * correlation down for an honest user.
 */
const LEAD_IN_MS = 1_200
/** Carrier SNR is sampled repeatedly and reduced to a median. */
const SNR_INTERVAL_MS = 500
const FFT_SIZE = 8192
/** Half-width of the carrier peak search, in bins. */
const PEAK_BINS = 4
/** Noise floor band, offset from the carrier. Doppler sidebands stay inside it. */
const FLOOR_FROM_HZ = 500
const FLOOR_TO_HZ = 1_500
/** Reported when the spectrum never showed anything measurable (e.g. dead mic). */
const NO_CARRIER_DB = -120

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
  /** Fired once the measured window opens — this is when the user must speak. */
  /**
   * Fired once the carrier is up and settled, `LEAD_IN_MS` before the window
   * opens. This — not the window itself — is when the user must be told to
   * start speaking.
   */
  onReady?: () => void
  onDoppler?: (sample: DopplerSample) => void
  onMouth?: (sample: MouthSample) => void
  onCarrierSnrDb?: (db: number) => void
}

export interface SonarSignals {
  doppler: DopplerSample[]
  mouthAperture: MouthSample[]
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
  const snrReadings: number[] = []

  // Our own capture: the browser's echo canceller and noise suppressor exist
  // precisely to delete what we are trying to measure, and a call's microphone
  // track has them on.
  const mic = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      channelCount: 1,
    },
  })
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
        dcAlpha: Math.exp((-2 * Math.PI * DC_CORNER_HZ) / basebandHz),
      },
    })
    const analyser = new AnalyserNode(ac, { fftSize: FFT_SIZE, smoothingTimeConstant: 0 })
    const micSource = ac.createMediaStreamSource(mic)
    micSource.connect(demod)
    micSource.connect(analyser)
    // The worklet emits silence, but a node the destination can't reach is
    // allowed to be culled from the rendering graph, so give it a muted sink.
    demod.connect(new GainNode(ac, { gain: 0 })).connect(ac.destination)

    await wait(WARMUP_MS, options.signal)

    // Ask now, measure shortly after, so the user is already mid-sentence when
    // the window opens.
    options.onReady?.()
    await wait(LEAD_IN_MS, options.signal)

    // Audio runs on its own clock. Anchor it to performance.now() once so the
    // Doppler series and the video series share a timebase; over a window this
    // short the two clocks don't drift enough to matter, and the verifier
    // searches for the residual lag anyway.
    const stamp = ac.getOutputTimestamp()
    const anchorContext = stamp.contextTime ?? ac.currentTime
    const anchorPerf = stamp.performanceTime ?? performance.now()
    const t0 = performance.now()
    const audioToElapsed = (sample: number) =>
      anchorPerf + (sample / ac.sampleRate - anchorContext) * 1000 - t0

    demod.port.onmessage = (event: MessageEvent<SonarFrameMessage>) => {
      const t = audioToElapsed(event.data.sample)
      // Frames queued during warm-up, while the DC tracker was still settling.
      if (t < 0) return
      const sample = { t, energy: event.data.rms }
      doppler.push(sample)
      options.onDoppler?.(sample)
    }

    tracker?.track(t0, (sample) => {
      mouthAperture.push(sample)
      options.onMouth?.(sample)
    })

    const spectrum = new Float32Array(analyser.frequencyBinCount)
    const readSnr = () => {
      analyser.getFloatFrequencyData(spectrum)
      const db = carrierSnrDb(spectrum, ac.sampleRate / FFT_SIZE, options.carrierHz)
      if (db == null) return
      snrReadings.push(db)
      options.onCarrierSnrDb?.(db)
    }
    snrTimer = setInterval(readSnr, SNR_INTERVAL_MS)
    readSnr()

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
 */
export async function runSonar(challenge: SonarChallenge, ctx: RunContext): Promise<SonarEvidence> {
  ctx.onPrompt?.(SONAR_PREPARING)
  try {
    const signals = await probeSonar({
      video: ctx.video,
      carrierHz: challenge.carrierHz,
      durationMs: challenge.durationMs,
      onReady: () => ctx.onPrompt?.(SONAR_PROMPT),
    })
    return { kind: 'sonar', ...signals }
  } finally {
    ctx.onPrompt?.(null)
  }
}

/**
 * Carrier peak over the noise floor a little further out, dB, or null when the
 * spectrum has nothing usable in it. A quiet result means the speaker or the
 * microphone rolls off before the carrier, not that the user is a replay.
 */
function carrierSnrDb(spectrum: Float32Array, binHz: number, carrierHz: number): number | null {
  const carrierBin = Math.round(carrierHz / binHz)
  const peak = Math.max(...finiteBins(spectrum, carrierBin - PEAK_BINS, carrierBin + PEAK_BINS))
  const from = Math.round(FLOOR_FROM_HZ / binHz)
  const to = Math.round(FLOOR_TO_HZ / binHz)
  const floor = median([
    ...finiteBins(spectrum, carrierBin - to, carrierBin - from),
    ...finiteBins(spectrum, carrierBin + from, carrierBin + to),
  ])
  if (!Number.isFinite(peak) || !Number.isFinite(floor)) return null
  return peak - floor
}

/** Silent bins read as -Infinity, which would poison a peak or a median. */
function finiteBins(spectrum: Float32Array, from: number, to: number): number[] {
  const out: number[] = []
  for (let i = Math.max(0, from); i <= Math.min(spectrum.length - 1, to); i++) {
    const db = spectrum[i]!
    if (Number.isFinite(db)) out.push(db)
  }
  return out
}

function median(xs: number[]): number {
  if (xs.length === 0) return Number.NaN
  const sorted = [...xs].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** Resolves on timeout *or* abort: aborting ends the probe, it isn't an error. */
function wait(ms: number, signal?: AbortSignal): Promise<void> {
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
