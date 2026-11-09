const TARGET_RATE = 16_000
const WINDOW_SIZE = 64_000
const TAPS = 63

/** Streaming anti-alias FIR followed by linear interpolation, using the actual device rate. */
export class StreamingResampler {
  private readonly ratio: number
  private readonly coefficients: Float64Array
  private readonly ring = new Float32Array(TAPS)
  private ringAt = 0
  private inputAt = 0
  private outputAt = 0
  private previous = 0

  constructor(inputRate: number) {
    if (!Number.isFinite(inputRate) || inputRate < TARGET_RATE || inputRate > 192_000) {
      throw new Error('unsupported microphone sample rate')
    }
    this.ratio = inputRate / TARGET_RATE
    this.coefficients = new Float64Array(TAPS)
    const cutoff = 0.45 * TARGET_RATE / inputRate
    let sum = 0
    for (let i = 0; i < TAPS; i++) {
      const x = i - (TAPS - 1) / 2
      const sinc = x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x)
      const value = sinc * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (TAPS - 1)))
      this.coefficients[i] = value
      sum += value
    }
    for (let i = 0; i < TAPS; i++) this.coefficients[i] /= sum
  }

  process(input: Float32Array, output: (sample: number) => void): void {
    for (const raw of input) {
      const sample = Number.isFinite(raw) ? raw : 0
      this.ring[this.ringAt] = sample
      let filtered = 0
      for (let k = 0; k < TAPS; k++) {
        filtered += this.ring[(this.ringAt - k + TAPS) % TAPS] * this.coefficients[k]
      }
      this.ringAt = (this.ringAt + 1) % TAPS
      while (this.outputAt * this.ratio <= this.inputAt) {
        const fraction = this.outputAt * this.ratio - (this.inputAt - 1)
        output(this.previous + (filtered - this.previous) * fraction)
        this.outputAt++
      }
      this.previous = filtered
      this.inputAt++
    }
  }

  clear(): void { this.ring.fill(0); this.previous = 0 }
}

export type EncodedWindow = { pcm16: ArrayBuffer | null; skipReason: string | null; sampleEnd: number }

/** Provisional energy gate, not a linguistic VAD; final quality checks remain in the sidecar. */
export class StreamingWindowEncoder {
  private readonly resampler: StreamingResampler
  private window = new Int16Array(WINDOW_SIZE)
  private cursor = 0
  private totalSamples = 0
  private squareSum = 0
  private frameSquareSum = 0
  private speechFrames = 0

  constructor(inputRate: number) { this.resampler = new StreamingResampler(inputRate) }

  process(input: Float32Array, emit: (window: EncodedWindow) => void): void {
    this.resampler.process(input, (sample) => {
      const value = Math.max(-1, Math.min(1, sample))
      this.window[this.cursor++] = Math.round(value * (value < 0 ? 32768 : 32767))
      this.totalSamples++
      this.squareSum += value * value
      this.frameSquareSum += value * value
      if (this.cursor % 320 === 0) {
        // 20 ms frames >= -45 dBFS, at least 2.5 seconds per 4 second window.
        if (this.frameSquareSum / 320 >= 10 ** (-45 / 10)) this.speechFrames++
        this.frameSquareSum = 0
      }
      if (this.cursor !== WINDOW_SIZE) return
      const silence = this.squareSum / WINDOW_SIZE < 10 ** (-55 / 10)
      const skipReason = silence ? 'silence' : this.speechFrames < 125 ? 'insufficient speech' : null
      const pcm16 = skipReason ? null : this.window.buffer
      if (skipReason) this.window.fill(0)
      emit({ pcm16, skipReason, sampleEnd: this.totalSamples })
      this.window = new Int16Array(WINDOW_SIZE)
      this.cursor = 0
      this.squareSum = 0
      this.frameSquareSum = 0
      this.speechFrames = 0
    })
  }

  clear(): void {
    this.window.fill(0)
    this.cursor = 0
    this.squareSum = 0
    this.frameSquareSum = 0
    this.speechFrames = 0
    this.resampler.clear()
  }
}
