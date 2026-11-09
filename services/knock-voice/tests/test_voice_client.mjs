import test from 'node:test';
import assert from 'node:assert/strict';
import { publicVoiceResult } from '../integration/voice-client.proposed.mjs';

test('public boundary forwards only label and timestamp', () => {
  const input = { label: 'review', modelScore: .9, reason: 'private', latencyMs: 12, audio: new ArrayBuffer(10) };
  assert.deepEqual(publicVoiceResult(input, 1234), { label: 'review', at: 1234 });
});
test('malformed result never becomes pass', () => {
  for (const input of [null, {}, { label: 'Pass' }, { label: 'bad' }]) {
    assert.equal(publicVoiceResult(input, 1234).label, 'unable');
  }
});
test('invalid timestamps are rejected', () => {
  for (const at of [NaN, Infinity, -1, undefined]) assert.throws(() => publicVoiceResult({label:'pass'}, at));
});
