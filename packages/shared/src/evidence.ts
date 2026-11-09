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

/** Mean camera levels (0–255) over one region of one frame. */
export const LightRoi = z.object({
  r: z.number(),
  g: z.number(),
  b: z.number(),
  /**
   * Fraction of the region's pixels at the top of the range. A clipped region
   * cannot get any brighter, so a flash measured there means nothing.
   */
  clipped: z.number().min(0).max(1),
})
export type LightRoi = z.infer<typeof LightRoi>

export const LightEvidence = z.object({
  kind: z.literal('light'),
  /**
   * One entry per sampled video frame. `face` is skin — forehead and both
   * cheeks; `surround` is the band just outside the head: wall, hair,
   * shoulders.
   *
   * The two share a timestamp on purpose. A real-time face swap leaves the
   * surroundings alone, so the scene reflects the panels while the generated
   * face does not. Reading both regions off the same frame is what makes that
   * comparison trustworthy — same exposure, same white balance, same instant.
   */
  frames: z
    .array(z.object({ t: z.number(), face: LightRoi, surround: LightRoi }))
    .max(3_000),
  /**
   * Receipt of what the panels showed and when, on the same clock as
   * `frames.t` and zeroed at the start of the run.
   *
   * The verifier builds its template from the *challenge*, never from this. A
   * client that supplied the template could go looking for onset times that
   * happen to fit a replayed video's own flicker; all this is used for is
   * confirming the issued schedule was actually rendered, and recovering the
   * one constant offset between the client's clock and the schedule.
   */
  emissions: z
    .array(z.object({ t: z.number(), color: z.string().regex(/^#[0-9a-fA-F]{6}$/) }))
    .max(200),
  /**
   * Which clock timed the frames. `callback` means `captureTime` was
   * unavailable, so every timestamp carries the camera pipeline delay and the
   * verifier has to widen its lag search — see docs/sonar.md §4.4, where the
   * same substitution made the echo appear to lead the lips.
   */
  videoClock: z.enum(['captureTime', 'callback']),
  /**
   * Camera modes as *reported*. The stream belongs to the call, so the SDK
   * reads these and changes nothing: reconfiguring exposure mid-interview to
   * suit a check is not a trade a call can make. Continuous exposure and white
   * balance work against the measurement by compensating the flash away, which
   * shows up as a squashed response — worth being able to tell apart from a
   * spoof afterwards.
   */
  cameraModes: z
    .object({ exposure: z.string().nullable(), whiteBalance: z.string().nullable() })
    .optional(),
})
export type LightEvidence = z.infer<typeof LightEvidence>

/**
 * Both series carry `t` in ms from the start of the probe window, on one clock:
 * audio frame indices are mapped onto `performance.now()` via
 * `AudioContext.getOutputTimestamp()`, video frames are timed by
 * `requestVideoFrameCallback`. The verifier relies on that shared timebase.
 */
export const SonarEvidence = z.object({
  kind: z.literal('sonar'),
  // Caps are generous for the issued windows (100 Hz and ~60 fps) but keep a
  // hostile client from handing the verifier an unbounded series.
  /** Movement energy: RMS of the DC-removed quadrature baseband per frame. */
  doppler: z.array(z.object({ t: z.number(), energy: z.number().nonnegative() })).max(6_000),
  /** Mouth aperture from face landmarks (e.g. MediaPipe), over face height. */
  mouthAperture: z.array(z.object({ t: z.number(), value: z.number() })).max(3_000),
  /**
   * Whole-head pose from the same frames. A single tone and a single mic give
   * one mixed number per frame, so the echo cannot be separated by position —
   * but video can, and a moving head is a far larger reflector than lips. The
   * verifier regresses this out before asking whether the lips explain what is
   * left.
   */
  head: z
    .array(z.object({ t: z.number(), scale: z.number(), x: z.number(), y: z.number() }))
    .max(3_000)
    .default([]),
  sampleRate: z.number().positive(),
  /** Carrier peak over the nearby noise floor, dB. Low ⇒ the probe never arrived. */
  carrierSnrDb: z.number(),
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
