import workletUrl from './capture-worklet.ts?worker&url'
import { matchNativeDevice } from '../environment/evidence.ts'
import { VoiceWindowController } from './controller.ts'
import type { EncodedWindow } from './dsp.ts'
import type { LocalVoiceReportEntry, VoicePublicResult, VoiceSnapshot, VoiceWindowResult } from './types.ts'

type CaptureOptions = {
  onResult: (result: VoicePublicResult) => void
  analyze?: (pcm16: ArrayBuffer) => Promise<VoiceWindowResult>
}

/** Owns only a cloned microphone track. The call's original stream is never stopped. */
export class LocalVoiceCapture {
  private readonly controller: VoiceWindowController
  private context: AudioContext | null = null
  private track: MediaStreamTrack | null = null
  private source: MediaStreamAudioSourceNode | null = null
  private node: AudioWorkletNode | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private generation = 0
  private unsubscribeAvailability: (() => void) | null = null

  constructor(options: CaptureOptions) {
    this.controller = new VoiceWindowController({
      onResult: options.onResult,
      analyze: options.analyze ?? ((pcm16) => {
        const bridge = window.knockNative
        return bridge?.analyzeVoiceWindow(pcm16) ?? Promise.resolve({
          label: 'unable', modelScore: null, reason: 'voice analyzer not running', latencyMs: 0,
        })
      }),
    })
  }

  subscribe(listener: (snapshot: VoiceSnapshot) => void): () => void { return this.controller.subscribe(listener) }
  getSnapshot(): VoiceSnapshot { return this.controller.getSnapshot() }
  getLocalReport(): LocalVoiceReportEntry[] { return this.controller.getLocalReport() }

  async start(stream: MediaStream): Promise<void> {
    this.stop()
    const generation = this.generation
    this.controller.start()
    let context: AudioContext | null = null
    let track: MediaStreamTrack | null = null
    try {
      const input = stream.getAudioTracks()[0]
      if (!input || input.readyState !== 'live') throw new Error('microphone unavailable')
      const bridge = window.knockNative
      if (bridge) {
        let availabilityVersion = 0
        this.unsubscribeAvailability = bridge.onVoiceAvailabilityChanged((available) => {
          availabilityVersion++
          if (generation === this.generation) this.controller.setAnalyzerAvailable(available)
        })
        const requestedAtVersion = availabilityVersion
        const available = await bridge.getVoiceAvailability()
        if (generation !== this.generation) return
        if (requestedAtVersion === availabilityVersion) this.controller.setAnalyzerAvailable(available)
      }
      const environment = await window.knockNative?.getEnvironment()
      if (generation !== this.generation) return
      const device = environment && matchNativeDevice(input.label, environment.microphones)
      if (!device || device.classification.verdict !== 'allowed') throw new Error('physical microphone not confirmed')
      track = input.clone()
      this.track = track
      track.onended = () => { this.controller.fail('microphone disconnected'); this.release() }
      context = new AudioContext()
      this.context = context
      await context.audioWorklet.addModule(workletUrl)
      if (generation !== this.generation) { track.stop(); if (context.state !== 'closed') void context.close().catch(() => {}); return }
      this.node = new AudioWorkletNode(context, 'knock-local-voice', {
        numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      })
      const startedAt = Date.now()
      this.node.port.onmessage = (event: MessageEvent<EncodedWindow>) => {
        if (generation !== this.generation) {
          if (event.data.pcm16?.byteLength) new Uint8Array(event.data.pcm16).fill(0)
          return
        }
        const { pcm16, skipReason, sampleEnd } = event.data
        if (pcm16) this.controller.enqueue(pcm16, startedAt + sampleEnd / 16)
        else this.controller.skip(skipReason ?? 'insufficient speech')
      }
      this.node.onprocessorerror = () => { this.controller.fail('microphone worklet failed'); this.release() }
      this.source = context.createMediaStreamSource(new MediaStream([track]))
      this.source.connect(this.node)
      // Processor writes no output samples; the graph remains pulled without mic playback.
      this.node.connect(context.destination)
      await context.resume()
      if (generation !== this.generation) return
      this.timer = setInterval(() => this.controller.tick(), 1000)
    } catch (error) {
      if (generation !== this.generation) { track?.stop(); if (context?.state !== 'closed') void context?.close().catch(() => {}); return }
      this.controller.fail(error instanceof Error ? error.message : 'microphone unavailable')
      this.release()
    }
  }

  stop(): void {
    this.generation++
    this.controller.stop()
    this.release()
  }

  private release(): void {
    // Also invalidate start() continuations waiting on addModule()/resume().
    this.generation++
    this.unsubscribeAvailability?.()
    this.unsubscribeAvailability = null
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.node) {
      this.node.port.onmessage = null
      this.node.onprocessorerror = null
      this.node.port.postMessage('stop')
      this.node.port.close()
      this.node.disconnect()
    }
    this.node = null
    this.source?.disconnect()
    this.source = null
    if (this.track) { this.track.onended = null; this.track.stop() }
    this.track = null
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {})
    this.context = null
  }
}
