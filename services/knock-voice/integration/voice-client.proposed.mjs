/** Public result boundary only. No audio upload, fetch, scores or diagnostic forwarding. */
export function publicVoiceResult(result, at) {
  const label = ['pass', 'review', 'unable'].includes(result?.label) ? result.label : 'unable';
  if (!Number.isFinite(at) || at < 0) throw new TypeError('valid local window timestamp required');
  return { label, at };
}
