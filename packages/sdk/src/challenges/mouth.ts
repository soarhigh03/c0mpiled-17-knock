import type { FaceLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision'

/**
 * Mouth aperture over time, from MediaPipe's Face Landmarker.
 *
 * Frames are timed with `requestVideoFrameCallback` so the series lines up
 * with the audio clock rather than with React's render loop.
 */

/** Pinned to the installed @mediapipe/tasks-vision; host apps may self-host. */
const DEFAULT_WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm'
const DEFAULT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

/** Face Mesh indices: inner lip centres, and the face-height reference pair. */
const UPPER_LIP = 13
const LOWER_LIP = 14
const FOREHEAD = 10
const CHIN = 152

export interface FaceModelOptions {
  /** Directory serving MediaPipe's vision wasm bundle. */
  wasmBase?: string
  /** URL of the Face Landmarker `.task` bundle. */
  modelUrl?: string
}

export interface MouthSample {
  /** ms since the probe window started, on the `performance.now()` clock. */
  t: number
  /** Lip gap divided by face height — scale- and distance-invariant. */
  value: number
}

export interface MouthTracker {
  /** Sample every video frame until `stop()`. */
  track(t0: number, onSample: (sample: MouthSample) => void): void
  stop(): void
}

/**
 * Returns `null` when the model or wasm runtime can't be loaded. That leaves
 * the sonar check without a video series, which the server reports as
 * inconclusive — a client that can't run the tracker is not evidence of a
 * spoof, so it must not be treated as one.
 */
export async function createMouthTracker(
  video: HTMLVideoElement,
  options: FaceModelOptions = {},
): Promise<MouthTracker | null> {
  let landmarker: FaceLandmarker
  try {
    const vision = await import('@mediapipe/tasks-vision')
    const fileset = await vision.FilesetResolver.forVisionTasks(options.wasmBase ?? DEFAULT_WASM_BASE)
    const modelAssetPath = options.modelUrl ?? DEFAULT_MODEL_URL
    const create = (delegate: 'GPU' | 'CPU') =>
      vision.FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
      })
    landmarker = await create('GPU').catch(() => create('CPU'))
  } catch (err) {
    console.warn('[knock] face landmarker unavailable; sonar has no video series', err)
    return null
  }

  const useFrameCallback = typeof video.requestVideoFrameCallback === 'function'
  let running = false
  let lastTimestamp = 0

  return {
    track(t0, onSample) {
      running = true

      const sample = (now: number, mediaTimeSec?: number) => {
        // A late callback can outlive stop(); the landmarker is closed by then.
        if (!running) return
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          // detectForVideo demands strictly increasing timestamps.
          const ts = Math.max(lastTimestamp + 1, Math.round((mediaTimeSec ?? now / 1000) * 1000))
          lastTimestamp = ts
          const face = landmarker.detectForVideo(video, ts).faceLandmarks[0]
          const value = face && aperture(face, video.videoWidth / video.videoHeight)
          if (value != null) onSample({ t: now - t0, value })
        }
        schedule()
      }

      const schedule = () => {
        if (!running) return
        if (useFrameCallback) {
          video.requestVideoFrameCallback((now, metadata) => sample(now, metadata.mediaTime))
        } else {
          requestAnimationFrame((now) => sample(now))
        }
      }

      schedule()
    },

    stop() {
      running = false
      landmarker.close()
    },
  }
}

/** Lip gap over face height, or null if the landmarks we need are missing. */
function aperture(face: NormalizedLandmark[], aspect: number): number | null {
  const upper = face[UPPER_LIP]
  const lower = face[LOWER_LIP]
  const forehead = face[FOREHEAD]
  const chin = face[CHIN]
  if (!upper || !lower || !forehead || !chin) return null

  const faceHeight = distance(forehead, chin, aspect)
  if (faceHeight <= 0) return null
  return distance(upper, lower, aspect) / faceHeight
}

/** Landmarks are normalised per axis, so x has to be un-squashed first. */
function distance(a: NormalizedLandmark, b: NormalizedLandmark, aspect: number): number {
  return Math.hypot((a.x - b.x) * aspect, a.y - b.y)
}
