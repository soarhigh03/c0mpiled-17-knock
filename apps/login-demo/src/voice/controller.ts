import type { LocalVoiceReportEntry, VoiceLabel, VoiceResult, VoiceSnapshot, VoiceWindowResult } from './types.ts'

/** Five windows cover 20 s. Stale or insufficient speech can never retain Pass beyond this. */
export const VOICE_FRESHNESS_MS = 20_000
export const WINDOW_SAMPLES = 64_000
export const MAX_PENDING_WINDOWS = 2
/** Native IPC normally times out first (30 s); this also bounds custom analyzer adapters. */
export const VOICE_INFERENCE_TIMEOUT_MS = 35_000
const REPORT_LIMIT = 150

type PendingWindow = { pcm16: ArrayBuffer; at: number }
type Options = {
  analyze: (pcm16: ArrayBuffer) => Promise<VoiceWindowResult>
  onResult: (result: VoiceResult) => void
  now?: () => number
}

const clear = (buffer: ArrayBuffer) => {
  // Transferred/detached buffers no longer belong to this process.
  if (buffer.byteLength) new Uint8Array(buffer).fill(0)
}

/** Queue, hysteresis and privacy boundary; independent of browser and Electron. */
export class VoiceWindowController {
  private readonly options: Options
  private readonly now: () => number
  private pending: PendingWindow[] = []
  private inflight: PendingWindow | null = null
  private inflightStartedAt: number | null = null
  private generation = 0
  private active = false
  private healthy = true
  private history: VoiceLabel[] = []
  private report: LocalVoiceReportEntry[] = []
  private listeners = new Set<(snapshot: VoiceSnapshot) => void>()
  private lastEvidenceAt: number | null = null
  private lastSubmittedAt = -Infinity
  private snapshot: VoiceSnapshot = {
    state: 'unable', lastWindowAt: null, backlog: 0,
    droppedWindows: 0, skipReason: null, reason: 'voice capture not started',
  }

  constructor(options: Options) {
    this.options = options
    this.now = options.now ?? Date.now
  }

  getSnapshot(): VoiceSnapshot { return { ...this.snapshot } }

  /** Explicit local-only report access; returns copies, never audio. */
  getLocalReport(): LocalVoiceReportEntry[] { return this.report.map((entry) => ({ ...entry })) }

  subscribe(listener: (snapshot: VoiceSnapshot) => void): () => void {
    this.listeners.add(listener)
    listener(this.getSnapshot())
    return () => { this.listeners.delete(listener) }
  }

  start(): void {
    this.stop()
    this.active = true
    this.healthy = true
    this.history = []
    this.report = []
    this.lastEvidenceAt = null
    this.lastSubmittedAt = -Infinity
    this.snapshot = {
      state: 'unable', lastWindowAt: null, backlog: 0,
      droppedWindows: 0, skipReason: null, reason: 'not enough speech to judge',
    }
    this.publish(this.now())
  }

  stop(): void {
    this.active = false
    this.generation++
    for (const item of this.pending) clear(item.pcm16)
    this.pending = []
    if (this.inflight) clear(this.inflight.pcm16)
    this.history = []
    this.report = []
    this.lastEvidenceAt = null
    this.snapshot = {
      state: 'unable', lastWindowAt: null, backlog: 0, droppedWindows: 0,
      skipReason: null, reason: 'voice capture stopped',
    }
    this.publish(this.now())
  }

  enqueue(pcm16: ArrayBuffer, at: number): void {
    if (!this.active || !this.healthy || pcm16.byteLength !== WINDOW_SAMPLES * 2 || !Number.isFinite(at) || at <= this.lastSubmittedAt) {
      clear(pcm16)
      return
    }
    this.lastSubmittedAt = at
    if (this.pending.length === MAX_PENDING_WINDOWS) {
      clear(this.pending.shift()!.pcm16)
      this.snapshot.droppedWindows++
    }
    this.pending.push({ pcm16, at })
    this.snapshot.skipReason = null
    this.snapshot.backlog = this.pending.length
    this.notify()
    this.pump()
  }

  skip(reason: string): void {
    if (!this.active) return
    this.snapshot.skipReason = reason
    this.tick()
    this.notify()
  }

  fail(reason: string): void {
    if (!this.active) return
    this.healthy = false
    this.generation++
    for (const item of this.pending) clear(item.pcm16)
    this.pending = []
    if (this.inflight) clear(this.inflight.pcm16)
    this.snapshot.backlog = 0
    this.history = []
    this.lastEvidenceAt = null
    this.snapshot.state = 'unable'
    this.snapshot.reason = reason
    this.publish(this.now())
  }

  setAnalyzerAvailable(available: boolean): void {
    if (!this.active) return
    if (!available) this.fail('voice analyzer not running')
    else this.healthy = true
  }

  tick(): void {
    if (!this.active) return
    if (this.inflight && this.inflightStartedAt !== null
      && this.now() - this.inflightStartedAt >= VOICE_INFERENCE_TIMEOUT_MS) {
      this.fail('voice analysis timed out')
      this.inflight = null
      this.inflightStartedAt = null
      return
    }
    if (this.lastEvidenceAt === null) return
    if (this.now() - this.lastEvidenceAt >= VOICE_FRESHNESS_MS) {
      this.history = []
      this.lastEvidenceAt = null
      this.snapshot.state = 'unable'
      this.snapshot.reason = this.snapshot.skipReason ?? 'voice evidence is stale'
      this.publish(this.now())
    }
  }

  private pump(): void {
    if (!this.active || !this.healthy || this.inflight || !this.pending.length) return
    const item = this.pending.shift()!
    const generation = this.generation
    this.inflight = item
    this.inflightStartedAt = this.now()
    this.snapshot.backlog = this.pending.length
    this.notify()
    void this.analyze(item, generation)
  }

  private async analyze(item: PendingWindow, generation: number): Promise<void> {
    let result: VoiceWindowResult
    try {
      result = await this.options.analyze(item.pcm16)
      if (!result || !['pass', 'review', 'unable'].includes(result.label)
        || !Number.isFinite(result.latencyMs)
        || (result.label !== 'unable' && (typeof result.modelScore !== 'number'
          || !Number.isFinite(result.modelScore) || result.modelScore < 0 || result.modelScore > 1))) {
        throw new Error('invalid analyzer result')
      }
    } catch {
      result = { label: 'unable', modelScore: null, reason: 'voice analyzer not running', latencyMs: 0 }
    } finally {
      clear(item.pcm16)
    }
    if (!this.active || generation !== this.generation) {
      if (this.inflight === item) { this.inflight = null; this.inflightStartedAt = null }
      this.pump()
      return
    }
    this.inflight = null
    this.inflightStartedAt = null
    this.snapshot.lastWindowAt = item.at
    const fresh = this.now() - item.at < VOICE_FRESHNESS_MS
    if (result.label === 'unable' || !fresh) {
      this.history = []
      this.lastEvidenceAt = null
      this.snapshot.state = 'unable'
      this.snapshot.reason = fresh ? result.reason ?? 'voice analysis unavailable' : 'voice evidence is stale'
    } else {
      this.lastEvidenceAt = item.at
      this.history = [...this.history, result.label].slice(-5)
      if (this.history.filter((label) => label === 'review').length >= 3) this.snapshot.state = 'review'
      else if (this.history.length >= 3 && this.history.slice(-3).every((label) => label === 'pass')) this.snapshot.state = 'pass'
      this.snapshot.reason = this.snapshot.state === 'unable' ? 'not enough speech to judge' : null
    }
    this.report.push({ ...result, at: item.at, aggregatedLabel: this.snapshot.state })
    if (this.report.length > REPORT_LIMIT) this.report.shift()
    this.publish(item.at)
    this.pump()
  }

  private publish(at: number): void {
    this.notify()
    // Deliberately construct the public DTO; scores, diagnostics and audio cannot cross here.
    this.options.onResult({ label: this.snapshot.state, at })
  }

  private notify(): void {
    for (const listener of this.listeners) listener(this.getSnapshot())
  }
}
