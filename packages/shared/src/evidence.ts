import { z } from 'zod'

/**
 * Evidence is raw-ish signal sent by the SDK. Judgement happens on the server,
 * never in the client, so a modified SDK can't simply report "pass".
 */

export const EnvironmentEvidence = z.object({
  kind: z.literal('environment'),
  videoInputs: z.array(z.object({ label: z.string(), deviceId: z.string() })),
  audioInputs: z.array(z.object({ label: z.string(), deviceId: z.string() })),
  screenCount: z.number().int().nonnegative().optional(),
  isFullscreen: z.boolean(),
  focusLostCount: z.number().int().nonnegative(),
  userAgent: z.string(),
})
export type EnvironmentEvidence = z.infer<typeof EnvironmentEvidence>

export const LightEvidence = z.object({
  kind: z.literal('light'),
  /** Mean RGB of the face skin ROI per sampled video frame. */
  samples: z.array(
    z.object({ t: z.number(), r: z.number(), g: z.number(), b: z.number() }),
  ),
})
export type LightEvidence = z.infer<typeof LightEvidence>

export const SonarEvidence = z.object({
  kind: z.literal('sonar'),
  /** Doppler energy around the carrier per time slot. */
  doppler: z.array(z.object({ t: z.number(), energy: z.number() })),
  /** Mouth aperture from face landmarks (e.g. MediaPipe) over the same window. */
  mouthAperture: z.array(z.object({ t: z.number(), value: z.number() })),
  sampleRate: z.number().positive(),
})
export type SonarEvidence = z.infer<typeof SonarEvidence>

export const VoiceEvidence = z.object({
  kind: z.literal('voice'),
  /** Base64-encoded mono PCM/WAV clip. */
  audioBase64: z.string(),
  sampleRate: z.number().positive(),
})
export type VoiceEvidence = z.infer<typeof VoiceEvidence>

export const Evidence = z.discriminatedUnion('kind', [
  EnvironmentEvidence,
  LightEvidence,
  SonarEvidence,
  VoiceEvidence,
])
export type Evidence = z.infer<typeof Evidence>
