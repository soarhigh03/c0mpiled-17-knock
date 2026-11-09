import type { FaceLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision'

/**
 * MediaPipe Face Landmarker, loaded once and driven off the video's own
 * frames.
 *
 * Both sonar and light need landmarks on a clock that lines up with something
 * else — the audio baseband in one case, the panel schedule in the other — and
 * the hard part is the clock rather than the landmarks. That lives here so the
 * two checks cannot drift apart on it.
 */

/** Pinned to the installed @mediapipe/tasks-vision; host apps may self-host. */
const DEFAULT_WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.2/wasm'
const DEFAULT_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'

export interface FaceModelOptions {
  /** Directory serving MediaPipe's vision wasm bundle. */
  wasmBase?: string
  /** URL of the Face Landmarker `.task` bundle. */
  modelUrl?: string
}

/**
 * Which clock timed a frame.
 *
 * `captureTime` is the instant the frame depicts. `callback` is when the
 * browser got round to telling us, which is a whole camera pipeline later —
 * easily 100–200 ms. Browsers only populate the former for some sources, and
 * silently falling back to the latter is what made sonar's echo appear to lead
 * the lips (docs/sonar.md §4.4). Checks that correlate against a known
 * timeline need to know which one they got.
 */
export type VideoClock = 'captureTime' | 'callback'

export interface FaceFrame {
  /** ms on the `performance.now()` clock. */
  at: number
  landmarks: NormalizedLandmark[]
  /** Frame width / height. Landmarks are normalised per axis, so x needs it. */
  aspect: number
  width: number
  height: number
  /** The element this frame is showing, for callers that read pixels too. */
  video: HTMLVideoElement
}

export interface FaceTracker {
  /** Which clock the frames are on. Conservative until the first one lands. */
  readonly clock: VideoClock
  /** Run `onFrame` for every video frame with a face in it, until `stop()`. */
  track(onFrame: (frame: FaceFrame) => void): void
  stop(): void
}

/**
 * Returns `null` when the model or the wasm runtime cannot be loaded. The
 * checks that depend on it then have no video series, which the server reports
 * as inconclusive — a client that cannot run the tracker is not evidence of a
 * spoof, so it must not be treated as one.
 */
export async function createFaceTracker(
  video: HTMLVideoElement,
  options: FaceModelOptions = {},
): Promise<FaceTracker | null> {
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
    console.warn('[knock] face landmarker unavailable; checks that need landmarks cannot run', err)
    return null
  }

  const useFrameCallback = typeof video.requestVideoFrameCallback === 'function'
  let running = false
  let lastTimestamp = 0
  // Assume the worse clock until a frame proves otherwise: a verifier that
  // widens its lag search for nothing loses a little precision, one that
  // narrows it wrongly loses the signal.
  let clock: VideoClock = 'callback'
  let clockReported = false

  return {
    get clock() {
      return clock
    },

    track(onFrame) {
      running = true

      const sample = (at: number, now: number, mediaTimeSec?: number) => {
        // A late callback can outlive stop(); the landmarker is closed by then.
        if (!running) return
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          // detectForVideo demands strictly increasing timestamps.
          const ts = Math.max(lastTimestamp + 1, Math.round((mediaTimeSec ?? now / 1000) * 1000))
          lastTimestamp = ts
          const landmarks = landmarker.detectForVideo(video, ts).faceLandmarks[0]
          if (landmarks) {
            onFrame({
              at,
              landmarks,
              aspect: video.videoWidth / video.videoHeight,
              width: video.videoWidth,
              height: video.videoHeight,
              video,
            })
          }
        }
        schedule()
      }

      const schedule = () => {
        if (!running) return
        if (useFrameCallback) {
          video.requestVideoFrameCallback((now, metadata) => {
            if (metadata.captureTime != null) clock = 'captureTime'
            if (!clockReported) {
              clockReported = true
              console.info(
                `[knock] video clock: ${metadata.captureTime == null ? 'callback (captureTime unavailable — expect a camera pipeline delay in every lag)' : 'captureTime'}`,
              )
            }
            sample(metadata.captureTime ?? now, now, metadata.mediaTime)
          })
        } else {
          requestAnimationFrame((now) => sample(now, now))
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
