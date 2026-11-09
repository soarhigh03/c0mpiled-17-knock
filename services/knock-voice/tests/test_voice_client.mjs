import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeVoice } from '../integration/voice-client.proposed.mjs';

const args = { wavBytes: new Uint8Array([0]), roomCode: 'abc123', sessionId: 's1', segmentId: 'a1' };
const ids = { room_code: 'abc123', session_id: 's1', segment_id: 'a1' };
const review = { schema_version: '1.0', ...ids, decision: 'Review', label: '합성 의심', reason: null,
  report: { model_score: { name: 'p_fake', value: 0.9, calibrated_probability: false } } };

test('server adapter keeps model score out of main UI payload', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => Response.json(review));
  const result = await analyzeVoice(args);
  assert.deepEqual(Object.keys(result.publicResult).sort(), [...Object.keys(ids), 'decision', 'label', 'reason'].sort());
  assert.equal(result.privateReport.model_score.value, 0.9);
  assert.equal(result.publicResult.decision, 'Review');
});

test('mismatched room/session and malformed result become Unable', async (t) => {
  for (const response of [{ ...review, session_id: 'other-session' }, null, { ...review, decision: 'Fail' }]) {
    const mock = t.mock.method(globalThis, 'fetch', async () => Response.json(response));
    assert.equal((await analyzeVoice(args)).publicResult.decision, 'Unable');
    mock.mock.restore();
  }
});

test('HTTP errors and network failures become Unable', async (t) => {
  const mock = t.mock.method(globalThis, 'fetch', async () => new Response('', { status: 429 }));
  assert.equal((await analyzeVoice(args)).publicResult.reason, 'analyzer_http_429');
  mock.mock.restore();
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('offline'); });
  assert.equal((await analyzeVoice(args)).publicResult.decision, 'Unable');
});
