import type { LightChallenge, LightEvidence } from '@knock/shared'
import type { RunContext } from '../client.ts'

/**
 * Flash the server-issued color sequence full-screen and sample the face's
 * mean color from the camera. Judgement is done server-side.
 *
 * TODO: replace the fixed center ROI with a face-landmark skin ROI (cheeks/forehead).
 */
export async function runLight(challenge: LightChallenge, ctx: RunContext): Promise<LightEvidence> {
  const overlay = document.createElement('div')
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483647',
    pointerEvents: 'none',
    transition: 'none',
  })
  document.body.appendChild(overlay)

  const canvas = document.createElement('canvas')
  const g = canvas.getContext('2d', { willReadFrequently: true })!
  const samples: LightEvidence['samples'] = []
  const t0 = performance.now()
  const totalMs = challenge.sequence.length * challenge.frameMs

  await new Promise<void>((resolve) => {
    const tick = () => {
      const t = performance.now() - t0
      if (t >= totalMs) return resolve()
      overlay.style.background = challenge.sequence[Math.floor(t / challenge.frameMs)]!
      samples.push({ t, ...sampleCenter(ctx.video, canvas, g) })
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })

  overlay.remove()
  return { kind: 'light', samples }
}

function sampleCenter(video: HTMLVideoElement, canvas: HTMLCanvasElement, g: CanvasRenderingContext2D) {
  const w = 64
  const h = 64
  canvas.width = w
  canvas.height = h
  const sw = video.videoWidth * 0.3
  const sh = video.videoHeight * 0.3
  g.drawImage(video, (video.videoWidth - sw) / 2, (video.videoHeight - sh) / 2, sw, sh, 0, 0, w, h)
  const data = g.getImageData(0, 0, w, h).data
  let r = 0
  let gr = 0
  let b = 0
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]!
    gr += data[i + 1]!
    b += data[i + 2]!
  }
  const n = data.length / 4
  return { r: r / n, g: gr / n, b: b / n }
}
