import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { VOICE_FRESHNESS_MS, VOICE_INFERENCE_TIMEOUT_MS, VoiceWindowController, WINDOW_SAMPLES } from './controller.ts'
import type { VoicePublicResult, VoiceWindowResult } from './types.ts'

const pcm = () => new Int16Array(WINDOW_SAMPLES).fill(123).buffer
const result = (label: VoiceWindowResult['label']): VoiceWindowResult => ({
  label, modelScore: label === 'unable' ? null : label === 'review' ? 0.9 : 0.1,
  reason: label === 'unable' ? 'voice analyzer not running' : null, latencyMs: 12,
})
const flush = async () => { await Promise.resolve(); await Promise.resolve() }

function harness() {
  let now = 0
  const calls: { audio: ArrayBuffer; resolve: (value: VoiceWindowResult) => void }[] = []
  const forwarded: VoicePublicResult[] = []
  const controller = new VoiceWindowController({
    analyze: (audio) => new Promise((resolve) => { calls.push({ audio, resolve }) }),
    onResult: (value) => forwarded.push(value), now: () => now,
  })
  controller.start()
  return { controller, calls, forwarded, time: (value: number) => { now = value } }
}

describe('local voice controller (explicit analyzer doubles)', () => {
  it('starts unable; establishes Pass after three windows; forwards only label and at', async () => {
    const h = harness()
    assert.equal(h.controller.getSnapshot().state, 'unable')
    for (let i = 0; i < 3; i++) {
      h.time(i * 4000)
      h.controller.enqueue(pcm(), i * 4000)
      h.calls[i].resolve(result('pass'))
      await flush()
      assert.equal(h.controller.getSnapshot().state, i === 2 ? 'pass' : 'unable')
    }
    assert.equal(h.controller.getLocalReport().length, 3)
    assert.equal(h.controller.getLocalReport()[0].modelScore, 0.1)
    assert.deepEqual(Object.keys(h.forwarded.at(-1)!).sort(), ['at', 'label'])
    const report = h.controller.getLocalReport()
    report[0].modelScore = 1
    assert.equal(h.controller.getLocalReport()[0].modelScore, 0.1)
  })

  it('uses three of last five for Review and last three Pass for recovery', async () => {
    const h = harness()
    const labels = ['review', 'pass', 'review', 'pass', 'review', 'pass', 'pass', 'pass'] as const
    for (const [i, label] of labels.entries()) {
      h.time(i * 4000)
      h.controller.enqueue(pcm(), i * 4000)
      h.calls[i].resolve(result(label))
      await flush()
      if (i === 4) assert.equal(h.controller.getSnapshot().state, 'review')
    }
    assert.equal(h.controller.getSnapshot().state, 'pass')
  })

  it('keeps one inference and two pending windows; drops oldest, scrubs buffers, preserves order', async () => {
    const h = harness()
    const windows = [pcm(), pcm(), pcm(), pcm()]
    windows.forEach((buffer, i) => h.controller.enqueue(buffer, i * 4000))
    assert.equal(h.calls.length, 1)
    assert.equal(h.controller.getSnapshot().backlog, 2)
    assert.equal(h.controller.getSnapshot().droppedWindows, 1)
    assert.ok(new Int16Array(windows[1]).every((n) => n === 0))
    h.calls[0].resolve(result('pass'))
    await flush()
    assert.equal(h.calls.length, 2)
    assert.equal(h.calls[1].audio, windows[2])
    h.calls[1].resolve(result('pass'))
    await flush()
    assert.equal(h.calls[2].audio, windows[3])
    h.calls[2].resolve(result('pass'))
    await flush()
    assert.equal(h.controller.getSnapshot().lastWindowAt, 12000)
    assert.equal(h.controller.getSnapshot().backlog, 0)
    windows.forEach((buffer) => assert.ok(new Int16Array(buffer).every((n) => n === 0)))
  })

  it('health failure immediately overrides hysteresis; late results cannot restore Pass', async () => {
    const h = harness()
    for (let i = 0; i < 3; i++) {
      h.controller.enqueue(pcm(), i * 4000)
      h.calls[i].resolve(result('pass'))
      await flush()
    }
    assert.equal(h.controller.getSnapshot().state, 'pass')
    h.controller.enqueue(pcm(), 12000)
    h.controller.setAnalyzerAvailable(false)
    assert.equal(h.controller.getSnapshot().state, 'unable')
    h.calls[3].resolve(result('pass'))
    await flush()
    assert.equal(h.controller.getSnapshot().state, 'unable')
    h.controller.enqueue(pcm(), 16000)
    assert.equal(h.calls.length, 4)
    h.controller.setAnalyzerAvailable(true)
    h.controller.enqueue(pcm(), 20000)
    h.calls[4].resolve(result('pass'))
    await flush()
    assert.equal(h.controller.getSnapshot().state, 'unable')
  })

  it('expires evidence during silence; no cached Pass survives freshness timeout', async () => {
    const h = harness()
    for (let i = 0; i < 3; i++) {
      h.time(i * 4000)
      h.controller.enqueue(pcm(), i * 4000)
      h.calls[i].resolve(result('pass'))
      await flush()
    }
    h.controller.skip('silence')
    h.time(8000 + VOICE_FRESHNESS_MS - 1)
    h.controller.tick()
    assert.equal(h.controller.getSnapshot().state, 'pass')
    h.time(8000 + VOICE_FRESHNESS_MS)
    h.controller.tick()
    assert.equal(h.controller.getSnapshot().state, 'unable')
    assert.equal(h.controller.getSnapshot().reason, 'silence')
  })

  it('rejects stale inferences and invalid scores; unavailable never becomes Pass', async () => {
    const h = harness()
    h.controller.enqueue(pcm(), 0)
    h.time(VOICE_FRESHNESS_MS + 1)
    h.calls[0].resolve(result('pass'))
    await flush()
    assert.equal(h.controller.getSnapshot().reason, 'voice evidence is stale')
    h.controller.enqueue(pcm(), VOICE_FRESHNESS_MS + 1)
    h.calls[1].resolve({ ...result('pass'), modelScore: NaN })
    await flush()
    assert.equal(h.controller.getSnapshot().state, 'unable')
    assert.equal(h.controller.getSnapshot().reason, 'voice analyzer not running')
  })

  it('stopping/replacing sessions clears reports/audio and discards old results without overlapping requests', async () => {
    const h = harness()
    const old = pcm()
    const pending = pcm()
    h.controller.enqueue(old, 0)
    h.controller.enqueue(pending, 4000)
    h.controller.stop()
    assert.equal(h.forwarded.at(-1)?.label, 'unable')
    assert.deepEqual(h.controller.getLocalReport(), [])
    assert.ok(new Int16Array(old).every((n) => n === 0))
    assert.ok(new Int16Array(pending).every((n) => n === 0))
    assert.equal(h.controller.getSnapshot().lastWindowAt, null)
    h.controller.start()
    h.controller.enqueue(pcm(), 8000)
    assert.equal(h.calls.length, 1)
    h.calls[0].resolve(result('review'))
    await flush()
    assert.equal(h.calls.length, 2)
    assert.equal(h.controller.getSnapshot().lastWindowAt, null)
    h.calls[1].resolve(result('pass'))
    await flush()
    assert.equal(h.controller.getLocalReport().length, 1)
    assert.equal(h.controller.getSnapshot().state, 'unable')
    assert.equal(h.controller.getSnapshot().droppedWindows, 0)
  })

  it('bounds a hung adapter and ignores its late completion after recovery', async () => {
    const h = harness()
    h.controller.enqueue(pcm(), 0)
    h.time(VOICE_INFERENCE_TIMEOUT_MS)
    h.controller.tick()
    assert.equal(h.controller.getSnapshot().reason, 'voice analysis timed out')
    assert.equal(h.controller.getSnapshot().state, 'unable')
    h.controller.start()
    h.controller.enqueue(pcm(), VOICE_INFERENCE_TIMEOUT_MS)
    assert.equal(h.calls.length, 2)
    h.calls[0].resolve(result('review'))
    await flush()
    assert.equal(h.controller.getLocalReport().length, 0)
    h.calls[1].resolve(result('pass'))
    await flush()
    assert.equal(h.controller.getLocalReport().length, 1)
    assert.equal(h.controller.getSnapshot().state, 'unable')
  })

  it('bounds the private local report and refuses malformed or out-of-order windows', async () => {
    const h = harness()
    const invalid = new ArrayBuffer(4)
    h.controller.enqueue(invalid, 0)
    assert.equal(h.calls.length, 0)
    for (let i = 0; i < 151; i++) {
      h.time(i * 4000)
      h.controller.enqueue(pcm(), i * 4000)
      h.calls[i].resolve(result('pass'))
      await flush()
    }
    assert.equal(h.controller.getLocalReport().length, 150)
    const duplicate = pcm()
    h.controller.enqueue(duplicate, 0)
    assert.equal(h.calls.length, 151)
    assert.ok(new Int16Array(duplicate).every((n) => n === 0))
  })
})
