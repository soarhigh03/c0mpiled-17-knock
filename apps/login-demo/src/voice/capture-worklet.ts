import { StreamingWindowEncoder } from './dsp.ts'

// AudioWorklet globals are absent from TypeScript's DOM library.
declare const sampleRate: number
declare class AudioWorkletProcessor { readonly port: MessagePort }
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void

class VoiceCaptureProcessor extends AudioWorkletProcessor {
  private readonly encoder = new StreamingWindowEncoder(sampleRate)
  private stopped = false

  constructor() {
    super()
    this.port.onmessage = (event) => {
      if (event.data === 'stop') {
        this.stopped = true
        this.encoder.clear()
        this.port.close()
      }
    }
  }

  process(inputs: Float32Array[][]): boolean {
    if (this.stopped) return false
    const channels = inputs[0]
    if (!channels?.length) return true
    const mono = new Float32Array(channels[0].length)
    for (const channel of channels) {
      for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / channels.length
    }
    this.encoder.process(mono, (window) => {
      this.port.postMessage(window, window.pcm16 ? [window.pcm16] : [])
    })
    mono.fill(0)
    return true
  }
}

registerProcessor('knock-local-voice', VoiceCaptureProcessor)
