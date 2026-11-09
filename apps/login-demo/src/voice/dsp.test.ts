import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { StreamingResampler, StreamingWindowEncoder } from './dsp.ts'
import type { EncodedWindow } from './dsp.ts'

const signal = (rate: number, seconds: number, hz = 300) => Float32Array.from(
  { length: rate * seconds }, (_, i) => 0.2 * Math.sin(2 * Math.PI * hz * i / rate),
)

describe('microphone DSP (synthetic math fixtures; no voice accuracy claims)', () => {
  it('uses actual 44.1k/48k rates and preserves consecutive four-second boundaries across chunks', () => {
    for (const rate of [44100, 48000]) {
      const encoder = new StreamingWindowEncoder(rate)
      const windows: EncodedWindow[] = []
      const input = signal(rate, 8)
      for (let i = 0; i < input.length; i += 128) encoder.process(input.subarray(i, i + 128), (value) => windows.push(value))
      assert.equal(windows.length, 2)
      assert.deepEqual(windows.map((w) => w.sampleEnd), [64000, 128000])
      assert.ok(windows.every((w) => w.pcm16?.byteLength === 128000 && w.skipReason === null))
    }
  })

  it('skips silence and fewer than 2.5 seconds of sufficient energy', () => {
    const encoder = new StreamingWindowEncoder(48000)
    const windows: EncodedWindow[] = []
    encoder.process(new Float32Array(48000 * 4), (w) => windows.push(w))
    encoder.process(signal(48000, 1), (w) => windows.push(w))
    encoder.process(new Float32Array(48000 * 3), (w) => windows.push(w))
    assert.equal(windows[0].skipReason, 'silence')
    assert.equal(windows[1].skipReason, 'insufficient speech')
    assert.ok(windows.every((w) => w.pcm16 === null))
  })

  it('attenuates frequencies above 16k Nyquist before downsampling', () => {
    const rms = (hz: number) => {
      const samples: number[] = []
      new StreamingResampler(48000).process(signal(48000, 1, hz), (sample) => samples.push(sample))
      const settled = samples.slice(100)
      return Math.sqrt(settled.reduce((sum, n) => sum + n * n, 0) / settled.length)
    }
    assert.ok(rms(12000) < rms(1000) / 50)
  })

  it('is independent of chunk boundaries and rejects unsupported rates', () => {
    const input = signal(44100, 1)
    const full: number[] = []
    const chunked: number[] = []
    new StreamingResampler(44100).process(input, (n) => full.push(n))
    const resampler = new StreamingResampler(44100)
    for (let i = 0; i < input.length; i += 113) resampler.process(input.subarray(i, i + 113), (n) => chunked.push(n))
    assert.deepEqual(chunked, full)
    assert.equal(full.length, 16000)
    assert.throws(() => new StreamingResampler(0))
  })
})
