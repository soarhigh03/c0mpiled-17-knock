import type { NormalizedLandmark } from '@mediapipe/tasks-vision'
import { createFaceTracker, type FaceModelOptions } from './face.ts'

/**
 * Mouth aperture over time, from MediaPipe's Face Landmarker.
 *
 * Frames are timed by `face.ts` so the series lines up with the audio clock
 * rather than with React's render loop.
 */

export type { FaceModelOptions }

/** Face Mesh indices: inner lip centres, and the face-height reference pair. */
const UPPER_LIP = 13
const LOWER_LIP = 14
const FOREHEAD = 10
const CHIN = 152

export interface MouthSample {
  /** ms since the probe window started, on the `performance.now()` clock. */
  t: number
  /** Lip gap divided by face height — scale- and distance-invariant. */
  value: number
}

/**
 * Where the whole head is, measured from the same landmarks as the aperture.
 *
 * The echo sums every moving reflector in the room, and a head is a far bigger
 * one than a pair of lips — nodding or leaning swamps the lip Doppler. Video
 * can separate them even though the microphone cannot, so the head's motion is
 * reported alongside the mouth's and the verifier regresses it out.
 */
export interface HeadSample {
  t: number
  /** Face height in frame units; grows as the head nears the camera. */
  scale: number
  /** Face centre in normalised frame coordinates. */
  x: number
  y: number
}

export interface FaceSample {
  mouth: MouthSample
  head: HeadSample
}

export interface MouthTracker {
  /** Sample every video frame until `stop()`. */
  track(t0: number, onSample: (sample: FaceSample) => void): void
  stop(): void
}

/**
 * Returns `null` when the landmarker can't be loaded, which leaves the sonar
 * check without a video series — the server reports that as inconclusive.
 */
export async function createMouthTracker(
  video: HTMLVideoElement,
  options: FaceModelOptions = {},
): Promise<MouthTracker | null> {
  const tracker = await createFaceTracker(video, options)
  if (!tracker) return null

  return {
    track(t0, onSample) {
      tracker.track((frame) => {
        const measured = measureFace(frame.landmarks, frame.aspect)
        if (!measured) return
        const t = frame.at - t0
        onSample({ mouth: { t, value: measured.aperture }, head: { t, ...measured.head } })
      })
    },

    stop: () => tracker.stop(),
  }
}

/** Aperture plus head pose, or null if the landmarks we need are missing. */
function measureFace(
  face: NormalizedLandmark[],
  aspect: number,
): { aperture: number; head: { scale: number; x: number; y: number } } | null {
  const upper = face[UPPER_LIP]
  const lower = face[LOWER_LIP]
  const forehead = face[FOREHEAD]
  const chin = face[CHIN]
  if (!upper || !lower || !forehead || !chin) return null

  const faceHeight = distance(forehead, chin, aspect)
  if (faceHeight <= 0) return null
  return {
    aperture: distance(upper, lower, aspect) / faceHeight,
    head: {
      scale: faceHeight,
      x: (forehead.x + chin.x) / 2,
      y: (forehead.y + chin.y) / 2,
    },
  }
}

/** Landmarks are normalised per axis, so x has to be un-squashed first. */
function distance(a: NormalizedLandmark, b: NormalizedLandmark, aspect: number): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y)
}
