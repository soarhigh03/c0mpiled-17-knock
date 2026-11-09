/**
 * Proposed Node 20+ server adapter. Not installed in packages/server or shared.
 * Call only after the server authenticates SDK upload and binds it to an active
 * room/session/challenge. Candidate-supplied identifiers are not authoritative.
 */
export async function analyzeVoice({ wavBytes, roomCode, sessionId, segmentId,
  endpoint = 'http://127.0.0.1:8765', timeoutMs = 60000 }) {
  const ids = { room_code: roomCode, session_id: sessionId, segment_id: segmentId };
  const unable = (reason) => ({
    publicResult: { ...ids, decision: 'Unable', label: '판단 보류', reason },
    privateReport: null,
  });
  const body = new FormData();
  for (const [key, value] of Object.entries(ids)) body.set(key, value);
  body.set('audio', new Blob([wavBytes], { type: 'audio/wav' }), 'segment.wav');
  let response;
  try {
    response = await fetch(`${endpoint}/v1/analyze`, {
      method: 'POST', body, signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return unable('analyzer_unreachable_or_timeout');
  }
  if (!response.ok) return unable(`analyzer_http_${response.status}`);
  let result;
  try { result = await response.json(); } catch { return unable('invalid_analyzer_response'); }
  const labels = { Review: '합성 의심', Pass: '뚜렷한 합성 신호 없음', Unable: '판단 보류' };
  if (!result || result.schema_version !== '1.0' ||
      !Object.hasOwn(labels, result.decision) || result.label !== labels[result.decision] ||
      !Object.entries(ids).every(([key, value]) => result[key] === value) ||
      (result.decision === 'Unable' ? typeof result.reason !== 'string' : result.reason !== null) ||
      typeof result.report !== 'object' || result.report === null) {
    return unable('invalid_analyzer_response');
  }
  return {
    // Main UI receives only this allowlist. No spread of the full analyzer result.
    publicResult: { ...ids, decision: result.decision, label: result.label, reason: result.reason },
    privateReport: result.report,
  };
}
