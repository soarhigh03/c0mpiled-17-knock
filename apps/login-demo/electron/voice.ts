import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { VoiceWindowResult } from '../src/knock-native.d.ts'

export type { VoiceWindowResult } from '../src/knock-native.d.ts'
export const PCM_WINDOW_BYTES = 16000 * 4 * 2
export const voiceUnavailable = (): VoiceWindowResult => ({
  label: 'unable', modelScore: null, reason: 'voice analyzer not running', latencyMs: 0,
})

export function isTrustedVoiceRenderer(sender: {
  knownWindow: boolean; mainFrame: boolean; candidate: boolean; url: string; devUrl?: string; indexPath: string
}): boolean {
  if (!sender.knownWindow || !sender.mainFrame || !sender.candidate) return false
  try {
    const url = new URL(sender.url)
    if (sender.devUrl) {
      const expected = new URL(sender.devUrl)
      return url.origin === expected.origin && url.pathname === expected.pathname
    }
    return url.protocol === 'file:' && fileURLToPath(url) === sender.indexPath
  } catch { return false }
}

/** PCM never touches a file; the only transport is an owned loopback child. */
export function pcmToWav(pcm: ArrayBuffer): Uint8Array<ArrayBuffer> {
  if (!(pcm instanceof ArrayBuffer) || pcm.byteLength !== PCM_WINDOW_BYTES) {
    throw new Error('Expected four seconds of mono PCM16 at 16 kHz')
  }
  const wav = new Uint8Array(44 + pcm.byteLength)
  const view = new DataView(wav.buffer)
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) wav[offset + i] = text.charCodeAt(i)
  }
  ascii(0, 'RIFF'); view.setUint32(4, wav.byteLength - 8, true); ascii(8, 'WAVE')
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true)
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data')
  view.setUint32(40, pcm.byteLength, true); wav.set(new Uint8Array(pcm), 44)
  return wav
}

type Request = (route: string, token: string, body?: Uint8Array<ArrayBuffer>, signal?: AbortSignal) => Promise<unknown>
type Dependencies = {
  spawn: (python: string, args: string[], options: { cwd: string; env: NodeJS.ProcessEnv }) => ChildProcess
  request: Request
  now: () => number
  wait: (ms: number) => Promise<void>
}
type Options = { servicePath: string; port?: number; readinessMs?: number; dependencies?: Partial<Dependencies>;
  onAvailabilityChanged?: (available: boolean) => void }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
export function parseVoiceResult(value: unknown): VoiceWindowResult | null {
  if (!isRecord(value) || !['review', 'pass', 'unable'].includes(String(value.label)) ||
      typeof value.latencyMs !== 'number' || !Number.isFinite(value.latencyMs) || value.latencyMs < 0 ||
      !(value.reason === null || typeof value.reason === 'string' && value.reason.length <= 1000)) return null
  if (value.label === 'unable' ? value.modelScore !== null :
    typeof value.modelScore !== 'number' || !Number.isFinite(value.modelScore) || value.modelScore < 0 || value.modelScore > 1) return null
  return { label: value.label as VoiceWindowResult['label'], modelScore: value.modelScore as number | null,
    reason: value.reason as string | null, latencyMs: value.latencyMs }
}

/** No cached verdicts. A generation invalidates readiness and inference on exit/quit. */
export class VoiceSidecar {
  private child: ChildProcess | null = null
  private generation = 0
  private quitting = false
  private restartUsed = false
  private exhausted = false
  private ready = false
  private starting: Promise<void> | null = null
  private inFlight = false
  private controller = new AbortController()
  private activeWav: Uint8Array<ArrayBuffer> | null = null
  private readonly onAvailabilityChanged: (available: boolean) => void
  private readonly deps: Dependencies
  private readonly token = randomBytes(32).toString('hex')
  private readonly port: number
  private readonly readinessMs: number
  private readonly servicePath: string

  constructor(options: Options) {
    this.port = options.port ?? 18765
    this.readinessMs = options.readinessMs ?? 60000
    this.servicePath = options.servicePath
    this.onAvailabilityChanged = options.onAvailabilityChanged ?? (() => {})
    this.deps = {
      spawn: (python, args, opts) => spawn(python, args, { ...opts, stdio: 'ignore', detached: false }),
      request: async (route, token, body, signal) => {
        const response = await fetch(`http://127.0.0.1:${this.port}${route}`, {
          method: body ? 'POST' : 'GET',
          headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'audio/wav' } : {}) },
          body, signal: AbortSignal.any([AbortSignal.timeout(body ? 30000 : 2000), ...(signal ? [signal] : [])]), redirect: 'error',
        })
        // Health uses 503 for starting/unavailable; inspect its explicit state.
        if ((!response.ok && route !== '/health') || !response.body) throw new Error('Sidecar request failed')
        const reader = response.body.getReader()
        const chunks: Uint8Array[] = []
        let bytes = 0
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            bytes += value.byteLength
            if (bytes > 4096) throw new Error('Sidecar response too large')
            chunks.push(value)
          }
        } finally { await reader.cancel() }
        return JSON.parse(Buffer.concat(chunks).toString('utf8'))
      },
      now: Date.now,
      wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
      ...options.dependencies,
    }
  }

  get available(): boolean { return this.ready && !this.quitting && this.child !== null }

  private setReady(ready: boolean): void {
    if (this.ready === ready) return
    this.ready = ready
    this.onAvailabilityChanged(ready)
  }

  start(): Promise<void> {
    if (this.quitting || this.exhausted || this.ready) return Promise.resolve()
    if (this.starting) return this.starting
    this.starting = this.launch().finally(() => { this.starting = null })
    return this.starting
  }

  private async launch(): Promise<void> {
    if (this.child || this.quitting) return
    const generation = ++this.generation
    this.controller = new AbortController()
    let child: ChildProcess
    try {
      child = this.deps.spawn(path.join(this.servicePath, '.venv/bin/python'), [
        '-m', 'knock_voice.cli', 'serve', '--host', '127.0.0.1', '--port', String(this.port),
        '--artifacts', path.join(this.servicePath, 'artifacts'),
      ], { cwd: this.servicePath, env: { ...process.env, HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1',
        PYTHONPATH: path.join(this.servicePath, 'src'), KNOCK_VOICE_TOKEN: this.token } })
    } catch { this.setReady(false); this.exhausted = true; return }
    this.child = child
    const crashed = () => {
      if (this.child !== child || this.quitting) return
      this.child = null; this.setReady(false); ++this.generation
      this.controller.abort(); this.activeWav?.fill(0)
      if (!this.restartUsed) {
        this.restartUsed = true
        // Wait for the old readiness task to settle before launching a replacement.
        void (this.starting ?? Promise.resolve()).then(() => this.start())
      } else this.exhausted = true
    }
    child.once('error', crashed)
    child.once('exit', crashed)
    const deadline = this.deps.now() + this.readinessMs
    while (!this.quitting && this.child === child && generation === this.generation && this.deps.now() < deadline) {
      try {
        const health = await this.deps.request('/health', this.token, undefined, this.controller.signal)
        if (isRecord(health) && health.status === 'ready') {
          if (!this.quitting && this.child === child && generation === this.generation) this.setReady(true)
          return
        }
        if (isRecord(health) && health.status === 'unavailable') break
      } catch { /* Model startup can precede the HTTP listener. */ }
      await this.deps.wait(250)
    }
    if (this.child === child) {
      this.exhausted = true
      this.setReady(false); this.child = null; ++this.generation
      this.controller.abort()
      await this.terminate(child)
    }
  }

  async analyze(pcm: ArrayBuffer): Promise<VoiceWindowResult> {
    if (!(pcm instanceof ArrayBuffer) || pcm.byteLength !== PCM_WINDOW_BYTES) {
      return { label: 'unable', modelScore: null, reason: 'invalid voice window', latencyMs: 0 }
    }
    if (!this.ready || !this.child || this.quitting) return voiceUnavailable()
    if (this.inFlight) return { label: 'unable', modelScore: null, reason: 'voice analyzer busy', latencyMs: 0 }
    const generation = this.generation
    this.inFlight = true
    const wav = pcmToWav(pcm)
    this.activeWav = wav
    try {
      const value = await this.deps.request('/analyze-window', this.token, wav, this.controller.signal)
      if (generation !== this.generation || !this.ready || this.quitting) return voiceUnavailable()
      const result = parseVoiceResult(value)
      if (!result) this.setReady(false)
      return result ?? voiceUnavailable()
    } catch {
      if (generation === this.generation) this.setReady(false)
      return voiceUnavailable()
    }
    finally { wav.fill(0); this.activeWav = null; this.inFlight = false }
  }

  private async terminate(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); resolve() }, 1500)
      child.once('exit', () => { clearTimeout(timer); resolve() })
      child.kill('SIGTERM')
    })
  }

  async stop(): Promise<void> {
    this.quitting = true; this.setReady(false); ++this.generation
    this.controller.abort(); this.activeWav?.fill(0)
    const child = this.child
    this.child = null
    if (child) await this.terminate(child)
  }
}
