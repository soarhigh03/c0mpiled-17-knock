import type { VoiceChallenge, VoiceEvidence } from '@knock/shared'
import type { RunContext } from '../client.ts'

/**
 * Record the user reading the issued phrase; the server runs anti-spoofing.
 * TODO: show challenge.phrase in UI, record ~4s via MediaRecorder/AudioWorklet, encode WAV → base64.
 */
export async function runVoice(challenge: VoiceChallenge, ctx: RunContext): Promise<VoiceEvidence> {
  void challenge
  void ctx
  return { kind: 'voice', audioBase64: '', sampleRate: 16_000 }
}
