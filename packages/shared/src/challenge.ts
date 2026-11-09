import { z } from 'zod'

/**
 * Challenges are issued by the server with fresh randomness every session,
 * so pre-recorded media or a tampered client cannot know the expected pattern.
 */
export const ChallengeKind = z.enum(['environment', 'light', 'sonar', 'voice'])
export type ChallengeKind = z.infer<typeof ChallengeKind>

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

/** One burst from the panels. They are dark (`#000000`) at every other moment. */
export const LightPulse = z.object({
  /** ms from the start of the run at which the panels light up. */
  atMs: z.number().int().nonnegative(),
  /** How long they stay lit. */
  holdMs: z.number().int().positive(),
  /** Panel color while lit. */
  color: z.string().regex(HEX_COLOR),
})
export type LightPulse = z.infer<typeof LightPulse>

/**
 * Light panels along the border of the call window flash intermittently; the
 * light reflected off the face has to follow them.
 *
 * **A border ring, not the full screen.** The check has to run *during* an
 * interview, and a product cannot blank the call to a strobing full-screen
 * color. The ring is worth roughly a quarter of the screen's flux, so the
 * reflected modulation is a few percent of the face's level rather than
 * obvious — which is why the verifier spends that budget on a lag-searched,
 * chance-referenced correlation instead of a brightness threshold.
 *
 * **Intermittent, not a continuous sweep.** The dark gaps are the baseline:
 * every pulse is scored against the dark frames either side of it, so "the
 * face got brighter" is measured against this room at this instant instead of
 * an assumed ambient level. Sonar needed the same correction for its carrier
 * SNR (docs/sonar.md §4.1).
 *
 * **Jittered onsets.** Unpredictable timing is half the replay defence — the
 * colors are the other half — and an aperiodic stimulus is also what keeps the
 * chance correlation low, the trap sonar fell into with a rhythmic prompt
 * (docs/sonar.md §4.3). It keeps the flash rate near 1 Hz as well, well under
 * the 3 Hz where flashing becomes a seizure risk.
 */
export const LightChallenge = z.object({
  kind: z.literal('light'),
  /** In onset order, non-overlapping. */
  pulses: z.array(LightPulse).min(3),
  /** Total run length, covering every pulse and the dark gap after the last. */
  durationMs: z.number().int().positive(),
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
