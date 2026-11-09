import type { CheckResult, LightChallenge, LightEvidence } from '@knock/shared'

/**
 * Photometric challenge: the face ROI's mean color should track the flashed
 * screen color with a small lag. A face-swap / replayed video won't.
 *
 * TODO(signal): resample samples onto frame slots, compute per-channel
 * correlation (with lag search 0–300ms) against challenge.sequence.
 */
export function verifyLight(challenge: LightChallenge, ev: LightEvidence): CheckResult {
  const expectedSamples = (challenge.sequence.length * challenge.frameMs) / 1000 * 10 // ≥10fps
  if (ev.samples.length < expectedSamples * 0.5) {
    return { kind: 'light', status: 'inconclusive', score: 0.5, reasons: ['too few samples'] }
  }

  const correlation = 0 // placeholder until the correlation is implemented
  return {
    kind: 'light',
    status: 'inconclusive',
    score: 0.5,
    reasons: [`not implemented yet (correlation=${correlation})`],
  }
}
