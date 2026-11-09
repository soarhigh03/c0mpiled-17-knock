import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { VoiceSidecar, pcmToWav, PCM_WINDOW_BYTES, parseVoiceResult, isTrustedVoiceRenderer } from '../electron/voice.ts'

class TestChild extends EventEmitter {
  exitCode: number | null = null
  signalCode: string | null = null
  killed = false
  kill(signal: string) {
    this.killed = true; this.signalCode = signal
    this.emit('exit', null, signal)
    return true
  }
  crash() { this.exitCode = 1; this.emit('exit', 1, null) }
}
function fixture(health: () => unknown = () => ({ status: 'ready' })) {
  const children: TestChild[] = []
  const spawns: { python: string; args: string[]; env: NodeJS.ProcessEnv }[] = []
  const requests: string[] = []
  let now = 0
  const sidecar = new VoiceSidecar({ servicePath: '/repo/services/knock-voice', readinessMs: 500,
    dependencies: {
      spawn: (python, args, opts) => {
        const child = new TestChild(); children.push(child); spawns.push({ python, args, env: opts.env })
        return child as unknown as ChildProcess
      },
      request: async route => { requests.push(route); return route === '/health' ? health() :
        { label: 'pass', modelScore: 0.1, reason: null, latencyMs: 12 } },
      now: () => now,
      wait: async ms => { now += ms },
    },
  })
  return { sidecar, children, spawns, requests }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

test('voice IPC allows only known candidate main frame at exact application URL', () => {
  const sender = { knownWindow: true, mainFrame: true, candidate: true,
    url: 'http://localhost:5174/?role=candidate', devUrl: 'http://localhost:5174/', indexPath: '/app/dist/index.html' }
  assert.equal(isTrustedVoiceRenderer(sender), true)
  for (const patch of [{ knownWindow: false }, { mainFrame: false }, { candidate: false },
    { url: 'http://localhost:5175/' }, { url: 'https://evil.test/' }, { url: 'http://localhost:5174/other' }, { url: 'invalid' }]) {
    assert.equal(isTrustedVoiceRenderer({ ...sender, ...patch }), false)
  }
  assert.equal(isTrustedVoiceRenderer({ ...sender, devUrl: undefined, url: 'file:///app/dist/index.html?role=candidate' }), true)
  assert.equal(isTrustedVoiceRenderer({ ...sender, devUrl: undefined, url: 'file:///other/index.html' }), false)
})

test('WAV stays in memory and validates exact PCM input', () => {
  const pcm = new ArrayBuffer(PCM_WINDOW_BYTES)
  const wav = pcmToWav(pcm)
  assert.equal(Buffer.from(wav.subarray(0, 4)).toString(), 'RIFF')
  const view = new DataView(wav.buffer)
  assert.equal(view.getUint32(24, true), 16000)
  assert.equal(view.getUint16(22, true), 1)
  assert.equal(view.getUint16(34, true), 16)
  assert.equal(view.getUint32(40, true), PCM_WINDOW_BYTES)
  assert.throws(() => pcmToWav(new ArrayBuffer(2)))
})

test('startup is single-flight and uses local offline python with authenticated request', async () => {
  const f = fixture()
  await Promise.all([f.sidecar.start(), f.sidecar.start()])
  assert.equal(f.children.length, 1)
  assert.equal(f.spawns[0].python, '/repo/services/knock-voice/.venv/bin/python')
  assert.equal(f.spawns[0].env.HF_HUB_OFFLINE, '1')
  assert.equal(f.spawns[0].env.TRANSFORMERS_OFFLINE, '1')
  assert.ok(f.spawns[0].env.KNOCK_VOICE_TOKEN)
  assert.ok(f.spawns[0].args.includes('/repo/services/knock-voice/artifacts'))
  assert.equal((await f.sidecar.analyze(new ArrayBuffer(PCM_WINDOW_BYTES))).label, 'pass')
  await f.sidecar.stop()
  assert.ok(f.children[0].killed)
  assert.equal((await f.sidecar.analyze(new ArrayBuffer(PCM_WINDOW_BYTES))).reason, 'voice analyzer not running')
})

test('starting readiness timeout and explicit unavailable never pass', async () => {
  for (const state of ['starting', 'unavailable']) {
    const f = fixture(() => ({ status: state }))
    await f.sidecar.start()
    assert.equal(f.children.length, 1)
    assert.ok(f.children[0].killed)
    assert.equal((await f.sidecar.analyze(new ArrayBuffer(PCM_WINDOW_BYTES))).label, 'unable')
    await f.sidecar.stop()
  }
})

test('unexpected crash restarts once and second crash remains unavailable', async () => {
  const f = fixture()
  await f.sidecar.start(); f.children[0].crash(); await flush()
  assert.equal(f.children.length, 2)
  assert.equal((await f.sidecar.analyze(new ArrayBuffer(PCM_WINDOW_BYTES))).label, 'pass')
  f.children[1].crash(); await flush()
  assert.equal(f.children.length, 2)
  assert.equal((await f.sidecar.analyze(new ArrayBuffer(PCM_WINDOW_BYTES))).label, 'unable')
  await f.sidecar.stop(); await f.sidecar.start()
  assert.equal(f.children.length, 2)
})

test('shutdown during pending readiness rejects late ready and prevents restart', async () => {
  let resolveHealth: (value: unknown) => void = () => {}
  const child = new TestChild()
  const sidecar = new VoiceSidecar({ servicePath: '/service', dependencies: {
    spawn: () => child as unknown as ChildProcess,
    request: () => new Promise(resolve => { resolveHealth = resolve }),
  } })
  const startup = sidecar.start()
  await sidecar.stop(); resolveHealth({ status: 'ready' }); await startup
  assert.ok(child.killed)
  assert.equal((await sidecar.analyze(new ArrayBuffer(PCM_WINDOW_BYTES))).label, 'unable')
})

test('malformed scores never yield a verdict and private extra response fields are stripped', () => {
  assert.equal(parseVoiceResult({ label: 'pass', modelScore: null, reason: null, latencyMs: 0 }), null)
  assert.equal(parseVoiceResult({ label: 'pass', modelScore: NaN, reason: null, latencyMs: 0 }), null)
  assert.equal(parseVoiceResult({ label: 'pass', modelScore: 2, reason: null, latencyMs: 0 }), null)
  assert.deepEqual(parseVoiceResult({ label: 'pass', modelScore: 0.1, reason: null, latencyMs: 1, audio: 'no' }),
    { label: 'pass', modelScore: 0.1, reason: null, latencyMs: 1 })
})

test('invalid IPC-sized buffers do not reach inference', async () => {
  const f = fixture(); await f.sidecar.start()
  assert.equal((await f.sidecar.analyze(new ArrayBuffer(PCM_WINDOW_BYTES + 2))).reason, 'invalid voice window')
  assert.deepEqual(f.requests, ['/health'])
  await f.sidecar.stop()
})

test('second crash exhausts restart budget even if start called again', async () => {
  const f = fixture(); await f.sidecar.start(); f.children[0].crash(); await flush()
  f.children[1].crash(); await flush(); await f.sidecar.start()
  assert.equal(f.children.length, 2)
  await f.sidecar.stop()
})

test('shutdown wipes and invalidates pending analysis, availability events track crash', async () => {
  let resolveAnalysis: (value: unknown) => void = () => {}
  let heldWav: Uint8Array | undefined
  const availability: boolean[] = []
  const child = new TestChild()
  const sidecar = new VoiceSidecar({ servicePath: '/service', onAvailabilityChanged: value => availability.push(value),
    dependencies: { spawn: () => child as unknown as ChildProcess,
      request: async (route, _token, body) => {
        if (route === '/health') return { status: 'ready' }
        heldWav = body
        return new Promise(resolve => { resolveAnalysis = resolve })
      },
    },
  })
  await sidecar.start()
  const result = sidecar.analyze(new ArrayBuffer(PCM_WINDOW_BYTES))
  assert.equal((await sidecar.analyze(new ArrayBuffer(PCM_WINDOW_BYTES))).reason, 'voice analyzer busy')
  await sidecar.stop()
  assert.ok(heldWav?.every(value => value === 0))
  resolveAnalysis({ label: 'pass', modelScore: 0.1, reason: null, latencyMs: 1 })
  assert.equal((await result).reason, 'voice analyzer not running')
  assert.deepEqual(availability, [true, false])
})
