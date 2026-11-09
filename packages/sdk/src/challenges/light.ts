import type { LightChallenge, LightEvidence, LightPulse, LightRoi } from '@knock/shared'
import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import type { RunContext } from '../client.ts'
import { wait } from './audio.ts'
import { createFaceTracker, type FaceFrame, type FaceModelOptions, type VideoClock } from './face.ts'
import { mountLightPanels } from './panels.ts'

/**
 * Flash the panels that frame the call window and record what the camera sees
 * reflected off the face — and, from the same frames, off everything around
 * it. The server decides whether either followed the schedule.
 *
 * Nothing here judges anything, and nothing here knows the schedule in
 * advance: the pulses arrive with the challenge.
 */

/** Working canvas width. ROI values are spatial means, so detail is wasted. */
const SAMPLE_WIDTH = 256
/** A pixel at or above this is at the sensor's ceiling and cannot rise. */
const CLIP_LEVEL = 250
/** The panels' idle state, and the baseline the server scores pulses against. */
const DARK = '#000000'
/**
 * How long to wait for the landmarker's first inference before starting
 * anyway. The first `detectForVideo` compiles shaders and can take most of a
 * second; running the schedule through that would spend the lead-in — and
 * possibly the first pulse — with no frames to show for it.
 */
const WARMUP_TIMEOUT_MS = 3_000
/**
 * Wall-clock slack on top of the issued window before the run gives up.
 *
 * The schedule is driven by `requestAnimationFrame`, which does not fire at
 * all in a hidden or minimised window — without a backstop the whole
 * verification would wait on a run that can never finish. Timing out returns
 * the partial series instead, and the server reads the missing emissions as
 * "the panels did not render the schedule" rather than as a spoof.
 */
const RUN_TIMEOUT_SLACK_MS = 5_000

/**
 * Face Mesh indices this file relies on. Deliberately only the unambiguous
 * ones — the oval extremes, the nose tip and the outer eye corners — with the
 * actual skin patches constructed geometrically from them further down. Named
 * "cheek" landmarks exist, but picking one by index and hoping it is on skin
 * for every face shape is how an ROI ends up sampling hair.
 */
const FOREHEAD_TOP = 10
const CHIN = 152
const OVAL_LEFT = 234
const OVAL_RIGHT = 454
const NOSE_TIP = 1
const EYE_LEFT = 33
const EYE_RIGHT = 263

export interface LightFrame {
  /** ms since the run started, on the `performance.now()` clock. */
  t: number
  face: LightRoi
  surround: LightRoi
}

export interface LightProbeOptions {
  /** A `<video>` already playing the camera stream; frames are read from it. */
  video: HTMLVideoElement
  pulses: readonly LightPulse[]
  durationMs: number
  /** The call's video track. Read for diagnostics only, never reconfigured. */
  track?: MediaStreamTrack
  /** Where to hang the panel ring; defaults to the whole window. */
  host?: HTMLElement
  /** Ends the run early and returns whatever was collected. */
  signal?: AbortSignal
  faceModel?: FaceModelOptions
  onFrame?: (frame: LightFrame) => void
  onEmission?: (emission: { t: number; color: string }) => void
}

export interface LightSignals {
  frames: LightFrame[]
  emissions: { t: number; color: string }[]
  videoClock: VideoClock
  cameraModes?: { exposure: string | null; whiteBalance: string | null }
}

/**
 * Run the panels and return the raw series. Exported for hardware bring-up
 * (see the Light Lab in apps/meet): how much of a border flash survives the
 * trip to the face and back is a property of the room, the distance and the
 * camera's exposure control, and that is worth seeing per machine before
 * blaming the verifier.
 */
export async function probeLight(options: LightProbeOptions): Promise<LightSignals> {
  const frames: LightFrame[] = []
  const emissions: { t: number; color: string }[] = []
  const cameraModes = readCameraModes(options.track)

  const tracker = await createFaceTracker(options.video, options.faceModel)
  // No landmarks means no regions, and no regions means nothing to measure.
  // Flashing the room to collect nothing would be worse than not running.
  if (!tracker) return { frames, emissions, videoClock: 'callback', cameraModes }

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) {
    tracker.stop()
    // Throwing rather than returning nothing: the client reports it through
    // onCheckError and the server scores the check `skipped`, which is a
    // truthful account of a browser that cannot give us pixels.
    throw new Error('2d canvas context unavailable; cannot sample video frames')
  }

  const panels = mountLightPanels({ host: options.host })
  /** Set once the run's clock starts; frames before it are warm-up. */
  let t0 = -1
  /** Stops a surviving animation frame from painting a removed ring. */
  let finished = false

  try {
    let firstFrame: (() => void) | null = null
    const warmed = new Promise<void>((resolve) => {
      firstFrame = resolve
    })
    tracker.track((frame) => {
      firstFrame?.()
      firstFrame = null
      if (t0 < 0) return
      const regions = sampleRegions(frame, canvas, context)
      if (!regions) return
      const sample = { t: frame.at - t0, ...regions }
      frames.push(sample)
      options.onFrame?.(sample)
    })
    // Warm the landmarker up before the clock starts, so the schedule is not
    // spent on shader compilation.
    await Promise.race([warmed, wait(WARMUP_TIMEOUT_MS, options.signal)])

    const run = new Promise<void>((resolve) => {
      /** Painted last tick, awaiting the timestamp at which it was on screen. */
      let painted: string | null = null
      let current: string | null = null

      const tick = (now: number) => {
        if (finished) return
        // Whatever the previous tick painted has been composited by now, so
        // `now` is the first instant the panels were certainly showing it.
        // Never early, at most one frame late — and one constant lateness is
        // precisely what the verifier's lag search removes.
        if (painted !== null) {
          if (t0 < 0) t0 = now
          const emission = { t: now - t0, color: painted }
          emissions.push(emission)
          options.onEmission?.(emission)
          painted = null
        }

        if (options.signal?.aborted) return resolve()
        const elapsed = t0 < 0 ? 0 : now - t0
        if (t0 >= 0 && elapsed >= options.durationMs) return resolve()

        // The clock starts with the dark ring already up, not with the first
        // pulse: the camera's exposure control gets the whole lead-in to
        // settle on a scene that already has a black border in it, and the
        // server gets a baseline that was measured under the same conditions
        // as the pulses.
        const color = t0 < 0 ? DARK : colorAt(options.pulses, elapsed)
        if (color !== current) {
          current = color
          panels.paint(color)
          painted = color
        }
        requestAnimationFrame(tick)
      }

      requestAnimationFrame(tick)
    })

    await Promise.race([
      run,
      wait(options.durationMs + RUN_TIMEOUT_SLACK_MS, options.signal),
    ])
  } finally {
    finished = true
    tracker.stop()
    panels.remove()
  }

  return { frames, emissions, videoClock: tracker.clock, cameraModes }
}

/**
 * Show the user the panels are about to flash, run them, hand the server the
 * raw series.
 *
 * Unlike sonar this cannot be passive — the screen has to change, and a border
 * that starts strobing with no warning reads as a bug. What it does avoid is
 * interrupting: the call stays on screen the whole time and nothing is asked
 * of the candidate beyond staying in frame.
 */
export async function runLight(challenge: LightChallenge, ctx: RunContext): Promise<LightEvidence> {
  ctx.onPrompt?.('Keep your face in view — the window border will flash a few times')
  try {
    const signals = await probeLight({
      video: ctx.video,
      track: ctx.stream.getVideoTracks()[0],
      pulses: challenge.pulses,
      durationMs: challenge.durationMs,
      host: ctx.panelHost,
      signal: ctx.signal,
    })
    return { kind: 'light', ...signals }
  } finally {
    ctx.onPrompt?.(null)
  }
}

function colorAt(pulses: readonly LightPulse[], elapsed: number): string {
  for (const pulse of pulses) {
    if (elapsed >= pulse.atMs && elapsed < pulse.atMs + pulse.holdMs) return pulse.color
  }
  return DARK
}

/**
 * Read-only. Reconfiguring exposure or white balance would help the
 * measurement and is not ours to do: the stream belongs to the call, and
 * nobody agreed to their camera being re-tuned mid-interview for a check.
 * Reporting the modes at least makes a flash the camera compensated away
 * diagnosable after the fact.
 */
function readCameraModes(track?: MediaStreamTrack): LightSignals['cameraModes'] {
  if (!track) return undefined
  // Image Capture extensions; most laptop cameras report `continuous`, some
  // report nothing at all.
  const settings = track.getSettings() as MediaTrackSettings & {
    exposureMode?: string
    whiteBalanceMode?: string
  }
  return {
    exposure: settings.exposureMode ?? null,
    whiteBalance: settings.whiteBalanceMode ?? null,
  }
}

interface Box {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Mean color of the skin, and of the band just outside the head, from one
 * frame.
 *
 * Both in one pass over one downscaled copy. The whole point of the second
 * region is that it shares the frame with the first — same exposure, same
 * white balance, same instant — so that "the room answered the panels and the
 * face did not" is a statement about the face and not about the camera.
 */
function sampleRegions(
  frame: FaceFrame,
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
): { face: LightRoi; surround: LightRoi } | null {
  const width = Math.min(SAMPLE_WIDTH, frame.width)
  const height = Math.max(1, Math.round(width / frame.aspect))
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width
    canvas.height = height
  }
  const regions = layout(frame.landmarks, width, height)
  // No skin patch survived — the face is at the frame's edge, or the landmarks
  // are degenerate. Drop the frame rather than report zeros the server would
  // read as a face sitting in the dark.
  if (!regions || regions.face.length === 0) return null

  context.drawImage(frame.video, 0, 0, width, height)
  const { data } = context.getImageData(0, 0, width, height)
  return {
    face: meanOf(data, width, regions.face),
    surround: meanOf(data, width, regions.surround),
  }
}

/**
 * Where to sample, in pixels of the working canvas.
 *
 * Skin patches are built from the oval extremes, the nose tip and the eye
 * corners rather than read off named landmarks, so they land on skin for a
 * wide range of face shapes. The surround boxes sit immediately outside the
 * face's bounding box, which keeps them off the face — if a swap's output
 * bled into the reference region, the comparison the whole check rests on
 * would quietly weaken.
 */
function layout(
  landmarks: NormalizedLandmark[],
  width: number,
  height: number,
): { face: Box[]; surround: Box[] } | null {
  const at = (index: number) => {
    const point = landmarks[index]
    return point ? { x: point.x * width, y: point.y * height } : null
  }
  const top = at(FOREHEAD_TOP)
  const chin = at(CHIN)
  const left = at(OVAL_LEFT)
  const right = at(OVAL_RIGHT)
  const nose = at(NOSE_TIP)
  const eyeL = at(EYE_LEFT)
  const eyeR = at(EYE_RIGHT)
  if (!top || !chin || !left || !right || !nose || !eyeL || !eyeR) return null

  const faceH = Math.hypot(top.x - chin.x, top.y - chin.y)
  const faceW = Math.hypot(left.x - right.x, left.y - right.y)
  if (!(faceH > 0) || !(faceW > 0)) return null

  const eyeMid = { x: (eyeL.x + eyeR.x) / 2, y: (eyeL.y + eyeR.y) / 2 }
  const patch = 0.09 * faceH
  const face = [
    // Mid-forehead: up from between the eyes, not all the way to the hairline.
    box(eyeMid.x + 0.45 * (top.x - eyeMid.x), eyeMid.y + 0.45 * (top.y - eyeMid.y), patch, patch),
    // Cheeks: out from the nose tip towards each side of the oval, then down
    // a little so the patch clears the eye.
    box(nose.x + 0.52 * (left.x - nose.x), nose.y + 0.52 * (left.y - nose.y) + 0.07 * faceH, patch, patch),
    box(nose.x + 0.52 * (right.x - nose.x), nose.y + 0.52 * (right.y - nose.y) + 0.07 * faceH, patch, patch),
  ]

  // Expanded so hair and the oval's own imprecision stay out of the reference.
  const minX = Math.min(top.x, chin.x, left.x, right.x) - 0.08 * faceW
  const maxX = Math.max(top.x, chin.x, left.x, right.x) + 0.08 * faceW
  const minY = Math.min(top.y, chin.y, left.y, right.y) - 0.08 * faceH
  const maxY = Math.max(top.y, chin.y, left.y, right.y) + 0.08 * faceH
  const midY = (minY + maxY) / 2
  const midX = (minX + maxX) / 2
  const surround = [
    { x0: minX - 0.3 * faceW, y0: midY - 0.3 * faceH, x1: minX, y1: midY + 0.3 * faceH },
    { x0: maxX, y0: midY - 0.3 * faceH, x1: maxX + 0.3 * faceW, y1: midY + 0.3 * faceH },
    { x0: midX - 0.3 * faceW, y0: minY - 0.25 * faceH, x1: midX + 0.3 * faceW, y1: minY },
  ]

  // A box mostly off the edge of the frame is not a region. When no surround
  // box survives — a face filling the whole frame — `surround` comes back
  // empty and the zeros tell the server there was nothing to cross-check
  // against, which is the truth.
  return { face: fit(face, width, height), surround: fit(surround, width, height) }
}

function box(cx: number, cy: number, halfW: number, halfH: number): Box {
  return { x0: cx - halfW, y0: cy - halfH, x1: cx + halfW, y1: cy + halfH }
}

/** How much of a box has to survive the frame's edges for it to be sampled. */
const MIN_BOX_FRACTION = 0.35

/** Clamp each box to the frame, dropping the ones that lost too much to it. */
function fit(boxes: Box[], width: number, height: number): Box[] {
  const kept: Box[] = []
  for (const nominal of boxes) {
    const clamped = {
      x0: Math.max(0, Math.floor(nominal.x0)),
      y0: Math.max(0, Math.floor(nominal.y0)),
      x1: Math.min(width, Math.ceil(nominal.x1)),
      y1: Math.min(height, Math.ceil(nominal.y1)),
    }
    const area = Math.max(0, clamped.x1 - clamped.x0) * Math.max(0, clamped.y1 - clamped.y0)
    const full = (nominal.x1 - nominal.x0) * (nominal.y1 - nominal.y0)
    if (area >= 1 && (full <= 0 || area / full >= MIN_BOX_FRACTION)) kept.push(clamped)
  }
  return kept
}

function meanOf(data: Uint8ClampedArray, width: number, boxes: Box[]): LightRoi {
  let r = 0
  let g = 0
  let b = 0
  let clipped = 0
  let n = 0
  for (const roi of boxes) {
    for (let y = roi.y0; y < roi.y1; y++) {
      for (let x = roi.x0; x < roi.x1; x++) {
        const i = (y * width + x) * 4
        const pr = data[i]!
        const pg = data[i + 1]!
        const pb = data[i + 2]!
        r += pr
        g += pg
        b += pb
        if (pr >= CLIP_LEVEL || pg >= CLIP_LEVEL || pb >= CLIP_LEVEL) clipped++
        n++
      }
    }
  }
  if (n === 0) return { r: 0, g: 0, b: 0, clipped: 0 }
  return { r: r / n, g: g / n, b: b / n, clipped: clipped / n }
}
