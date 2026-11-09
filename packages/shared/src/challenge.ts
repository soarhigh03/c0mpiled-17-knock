import { z } from 'zod'

/**
 * Challenges are issued by the server with fresh randomness every session,
 * so pre-recorded media or a tampered client cannot know the expected pattern.
 */
export const ChallengeKind = z.enum(['environment', 'light', 'sonar', 'voice'])
export type ChallengeKind = z.infer<typeof ChallengeKind>

/** Screen flash sequence; the face's reflected color must follow it. */
export const LightChallenge = z.object({
  kind: z.literal('light'),
  /** Hex colors shown full-screen, in order. */
  sequence: z.array(z.string().regex(/^#[0-9a-fA-F]{6}$/)).min(4),
  /** Duration of each color frame in ms. */
  frameMs: z.number().int().positive(),
})
export type LightChallenge = z.infer<typeof LightChallenge>

/**
 * Near-ultrasonic probe; mouth-motion Doppler must match video lip motion.
 *
 * The carrier is a continuous tone, deliberately *not* on/off keyed: the
 * receiver removes the DC (direct path + static reflection) component of the
 * baseband, and gating the carrier would inject step transients far larger
 * than the mouth Doppler we are looking for. Replay resistance comes from the
 * per-session carrier frequency instead — a recording made at another
 * frequency demodulates to noise.
 */
export const SonarChallenge = z.object({
  kind: z.literal('sonar'),
  /** Carrier in Hz, freshly drawn per session (near-ultrasonic, 17–22 kHz). */
  carrierHz: z.number().min(17_000).max(22_000),
  durationMs: z.number().int().positive(),
})
export type SonarChallenge = z.infer<typeof SonarChallenge>

export const EnvironmentChallenge = z.object({
  kind: z.literal('environment'),
})
export type EnvironmentChallenge = z.infer<typeof EnvironmentChallenge>

/** Phrase the user reads aloud; audio is checked for synthetic speech. */
export const VoiceChallenge = z.object({
  kind: z.literal('voice'),
  phrase: z.string().min(1),
})
export type VoiceChallenge = z.infer<typeof VoiceChallenge>

export const Challenge = z.discriminatedUnion('kind', [
  EnvironmentChallenge,
  LightChallenge,
  SonarChallenge,
  VoiceChallenge,
])
export type Challenge = z.infer<typeof Challenge>
