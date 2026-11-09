import type { CheckResult, VoiceChallenge, VoiceEvidence } from '@knock/shared'

/**
 * Synthetic speech (anti-spoofing) detection — not speaker verification.
 * Plan: call a Python sidecar running a pretrained AASIST/RawNet2 model.
 *
 * TODO: POST ev.audioBase64 to the sidecar; optionally ASR-check challenge.phrase.
 */
export async function verifyVoice(challenge: VoiceChallenge, ev: VoiceEvidence): Promise<CheckResult> {
  void challenge
  void ev
  return { kind: 'voice', status: 'inconclusive', score: 0.5, reasons: ['not implemented yet'] }
}
