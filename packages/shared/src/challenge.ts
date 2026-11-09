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

/** Near-ultrasonic probe; mouth-motion Doppler must match video lip motion. */
export const SonarChallenge = z.object({
  kind: z.literal('sonar'),
  /** Carrier frequencies in Hz (e.g. 18_000–21_000). */
  carriersHz: z.array(z.number().positive()).min(1),
  /** Randomised on/off keying pattern so a replay can't anticipate it. */
  pattern: z.array(z.union([z.literal(0), z.literal(1)])),
  slotMs: z.number().int().positive(),
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
