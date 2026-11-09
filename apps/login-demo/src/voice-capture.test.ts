/// <reference types="vite/client" />
import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import type { KnockNative } from './knock-native.d.ts'
import type { NativeEnvironment } from './environment/types.ts'

// Vite normally resolves this asset URL. No production capture or model is mocked globally.
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.endsWith('capture-worklet.ts?worker&url')) {
      return { url: 'data:text/javascript,export default "test-worklet-url"', shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})
const { LocalVoiceCapture } = await import('./voice/capture.ts')
const { SdkKnockClient, NOT_RUN_REASON } = await import('./knock/sdkClient.ts')
hooks.deregister()
const deferred = <T>() => {
  let resolve: (value: T) => void = () => {}
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const flush = () => new Promise(resolve => setImmediate(resolve))

class FakeTrack {
  label = 'MacBook Pro Microphone'
  readyState = 'live'
  stopped = 0
  clones: FakeTrack[] = []
  onended: (() => void) | null = null
  clone() { const clone = new FakeTrack(); this.clones.push(clone); return clone }
  stop() { this.stopped++; this.readyState = 'ended' }
}
class FakeNode {
  connected: unknown[] = []
  disconnected = 0
  connect(target: unknown) { this.connected.push(target) }
  disconnect() { this.disconnected++ }
}
class FakeWorklet extends FakeNode {
  static created: FakeWorklet[] = []
  onprocessorerror: (() => void) | null = null
  port = { onmessage: null as ((event: { data: unknown }) => void) | null, closed: false,
    messages: [] as unknown[], postMessage(value: unknown) { this.messages.push(value) }, close() { this.closed = true } }
  constructor() { super(); FakeWorklet.created.push(this) }
}
class FakeContext {
  static created: FakeContext[] = []
  static moduleGate: Promise<void> = Promise.resolve()
  static resumeGate: Promise<void> = Promise.resolve()
  state = 'suspended'
  source = new FakeNode()
  destination = {}
  closes = 0
  audioWorklet = { addModule: async (url: string) => { assert.equal(url, 'test-worklet-url'); await FakeContext.moduleGate } }
  constructor() { FakeContext.created.push(this) }
  createMediaStreamSource() { return this.source }
  async resume() { await FakeContext.resumeGate; if (this.state !== 'closed') this.state = 'running' }
  async close() { this.closes++; this.state = 'closed' }
}

function setup(t: TestContext) {
  FakeContext.created = []; FakeWorklet.created = []
  FakeContext.moduleGate = Promise.resolve(); FakeContext.resumeGate = Promise.resolve()
  const globals = globalThis as unknown as Record<string, unknown>
  const restore = new Map<string, unknown>()
  for (const name of ['window', 'document', 'AudioContext', 'AudioWorkletNode', 'MediaStream']) restore.set(name, globals[name])
  const environment = { microphones: [{ name: 'MacBook Pro Microphone', classification: { verdict: 'allowed' } }] } as NativeEnvironment
  let availability: ((value: boolean) => void) | undefined
  let unsubscribes = 0
  const bridge: Partial<KnockNative> = {
    getVoiceAvailability: async () => true,
    onVoiceAvailabilityChanged: listener => { availability = listener; return () => { unsubscribes++ } },
    getEnvironment: async () => environment,
    analyzeVoiceWindow: async () => ({ label: 'pass', modelScore: 0.1, reason: null, latencyMs: 1 }),
  }
  globals.window = { knockNative: bridge, addEventListener() {}, removeEventListener() {} }
  globals.document = { addEventListener() {}, removeEventListener() {} }
  globals.AudioContext = FakeContext
  globals.AudioWorkletNode = FakeWorklet
  globals.MediaStream = class { tracks: FakeTrack[]; constructor(tracks: FakeTrack[]) { this.tracks = tracks } }
  const input = new FakeTrack()
  const stream = { getAudioTracks: () => [input] } as unknown as MediaStream
  const published: unknown[] = []
  const capture = new LocalVoiceCapture({ onResult: result => published.push(result) })
  t.after(() => { capture.stop(); for (const [key, value] of restore) {
    if (value === undefined) delete globals[key]; else globals[key] = value
  } })
  return { capture, input, stream, bridge, published,
    availability: (value: boolean) => availability?.(value), unsubscribes: () => unsubscribes }
}

test('browser capture clones physical mic and tears down graph, port, clone, and subscription', async t => {
  const f = setup(t)
  await f.capture.start(f.stream)
  assert.equal(f.input.clones.length, 1)
  const context = FakeContext.created[0]
  const worklet = FakeWorklet.created[0]
  assert.equal(context.source.connected[0], worklet)
  assert.equal(worklet.connected[0], context.destination)
  for (let index = 1; index <= 3; index++) {
    worklet.port.onmessage?.({ data: { pcm16: new ArrayBuffer(128000), sampleEnd: index * 64000 } })
    await flush()
  }
  assert.equal(f.capture.getSnapshot().state, 'pass')
  for (const entry of f.published) assert.deepEqual(Object.keys(entry as object).sort(), ['at', 'label'])
  f.capture.stop()
  assert.equal(f.input.stopped, 0)
  assert.equal(f.input.clones[0].stopped, 1)
  assert.equal(context.source.disconnected, 1)
  assert.equal(worklet.disconnected, 1)
  assert.equal(worklet.port.closed, true)
  assert.deepEqual(worklet.port.messages, ['stop'])
  assert.equal(context.closes, 1)
  assert.equal(f.unsubscribes(), 1)
  assert.equal(f.capture.getSnapshot().backlog, 0)
  assert.deepEqual(f.capture.getLocalReport(), [])
})

test('stop while native availability is pending never clones or starts audio graph', async t => {
  const f = setup(t)
  const gate = deferred<boolean>(); f.bridge.getVoiceAvailability = () => gate.promise
  const starting = f.capture.start(f.stream)
  f.capture.stop(); gate.resolve(true); await starting
  assert.equal(f.input.clones.length, 0)
  assert.equal(FakeContext.created.length, 0)
  assert.equal(f.unsubscribes(), 1)
  assert.equal(f.capture.getSnapshot().state, 'unable')
})

test('newer unavailable event wins over stale native availability getter', async t => {
  const f = setup(t)
  const gate = deferred<boolean>(); f.bridge.getVoiceAvailability = () => gate.promise
  const starting = f.capture.start(f.stream)
  f.availability(false); gate.resolve(true); await starting
  assert.equal(f.capture.getSnapshot().state, 'unable')
  assert.equal(f.capture.getSnapshot().reason, 'voice analyzer not running')
  const worklet = FakeWorklet.created[0]
  for (let index = 1; index <= 3; index++) {
    worklet.port.onmessage?.({ data: { pcm16: new ArrayBuffer(128000), sampleEnd: index * 64000 } })
    await flush()
  }
  assert.equal(f.capture.getSnapshot().state, 'unable')
})

test('ended microphone during worklet loading cannot create a late graph', async t => {
  const f = setup(t)
  const gate = deferred<void>(); FakeContext.moduleGate = gate.promise
  const starting = f.capture.start(f.stream)
  await flush()
  f.input.clones[0].onended?.()
  gate.resolve(); await starting
  assert.equal(FakeWorklet.created.length, 0)
  assert.equal(FakeContext.created[0].state, 'closed')
  assert.equal(f.capture.getSnapshot().state, 'unable')
  assert.equal(f.unsubscribes(), 1)
})

test('processor failure while resume is pending releases every owned resource', async t => {
  const f = setup(t)
  const gate = deferred<void>(); FakeContext.resumeGate = gate.promise
  const starting = f.capture.start(f.stream)
  await flush()
  const worklet = FakeWorklet.created[0]
  worklet.onprocessorerror?.()
  gate.resolve(); await starting
  assert.equal(worklet.disconnected, 1)
  assert.equal(worklet.port.closed, true)
  assert.equal(f.input.clones[0].stopped, 1)
  assert.equal(FakeContext.created[0].state, 'closed')
  assert.equal(f.capture.getSnapshot().reason, 'microphone worklet failed')
})

test('actual KnockClient keeps private scores and audio outside serialized session state', async t => {
  const f = setup(t)
  f.bridge.analyzeVoiceWindow = async () => ({
    label: 'pass', modelScore: 0.123456789, reason: 'PRIVATE_LOCAL_DIAGNOSTIC_SENTINEL', latencyMs: 15,
  })
  const client = new SdkKnockClient({ apiUrl: 'http://unused.invalid', checks: ['voice'], checkOnAttach: false })
  const publicResults: unknown[] = []
  const unsubscribe = client.subscribeLocalVoice(value => publicResults.push(value))
  client.attachMedia(f.stream)
  try {
    await flush()
    const worklet = FakeWorklet.created[0]
    assert.ok(worklet)
    for (let index = 1; index <= 3; index++) {
      const pcm16 = new ArrayBuffer(128000)
      new Uint8Array(pcm16).fill(79)
      worklet.port.onmessage?.({ data: { pcm16, sampleEnd: index * 64000 } })
      await flush()
      assert.ok(new Uint8Array(pcm16).every(value => value === 0))
    }
    assert.equal(client.getLocalVoiceResult().label, 'pass')
    assert.deepEqual(Object.keys(client.getLocalVoiceResult()).sort(), ['at', 'label'])
    for (const entry of publicResults) assert.deepEqual(Object.keys(entry as object).sort(), ['at', 'label'])
    const serialized = JSON.stringify(client.getState())
    for (const privateField of ['modelScore', '0.123456789', 'PRIVATE_LOCAL_DIAGNOSTIC_SENTINEL', 'pcm16', 'audioBase64']) {
      assert.equal(serialized.includes(privateField), false, privateField)
    }
    assert.ok(NOT_RUN_REASON.voice, 'Shared server voice check must remain excluded pending label-only contract')
    assert.equal(client.getState().checks[0].status, 'waiting')
  } finally {
    client.attachMedia(null)
    unsubscribe()
  }
  assert.equal(client.getLocalVoiceResult().label, 'unable')
  assert.equal(f.input.stopped, 0)
  assert.equal(f.input.clones[0].stopped, 1)
  assert.equal(FakeContext.created[0].state, 'closed')
})
