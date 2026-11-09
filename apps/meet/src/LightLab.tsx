import { useEffect, useRef, useState } from 'react'
import { probeLight, type LightFrame, type LightPulse, type LightSignals } from '@knock/sdk'

/**
 * Hardware bring-up view: how much of a border flash actually comes back off
 * your face, on this machine, in this room.
 *
 * The verifier's thresholds are a guess until this has been run somewhere real
 * (docs/light.md §6). What matters here is not a verdict — the verdict is
 * server-side — but four numbers:
 *
 * - **depth** per pulse. A border ring is roughly a quarter of the screen's
 *   flux, so a few percent is the expected order. Under 1% the check cannot
 *   reach a verdict; if that is what this machine gives, the ring is too thin
 *   or the room is too bright.
 * - **decay**: the response over the back half of a pulse against the front
 *   half. Well under 1 means the camera's exposure control is compensating the
 *   flash away mid-pulse, which is the failure mode the hold length is sized
 *   against.
 * - **clipped**: an over-exposed region cannot get brighter, and a response
 *   measured there means nothing.
 * - **clock**: `callback` means `captureTime` was unavailable and every lag
 *   carries the camera pipeline delay (docs/sonar.md §4.4).
 *
 * The schedule here is generated locally, so this is a measurement tool and
 * not a check: a locally known schedule proves nothing about liveness.
 */

const PALETTE = ['#ff0000', '#00ff00', '#0000ff', '#00ffff', '#ff00ff', '#ffff00', '#ffffff']
const HOLD_MS = 320
const GAP_MIN_MS = 440
const GAP_JITTER_MS = 520
const LEAD_IN_MS = 700
/** Dead zone at each edge of a pulse, matching the verifier's. */
const GUARD_MS = 60

interface PulseReading {
  color: string
  /** Response along the pulse color, in camera levels. */
  delta: number
  /** The same, over the region's own level. */
  depth: number
  /** Back half of the hold over the front half; well under 1 means exposure. */
  decay: number
  frames: number
}

export function LightLab({ stream }: { stream: MediaStream | null }) {
  const [running, setRunning] = useState(false)
  const [signals, setSignals] = useState<LightSignals | null>(null)
  const [pulses, setPulses] = useState<LightPulse[]>(() => schedule().pulses)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState<LightFrame | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // The lab reads frames from its own element so it can run independently of
  // the interview view; a stream can feed any number of <video>s.
  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream
  }, [stream])

  useEffect(() => () => abortRef.current?.abort(), [])

  async function start() {
    const video = videoRef.current
    if (!video) return
    const controller = new AbortController()
    abortRef.current = controller
    const next = schedule()
    setPulses(next.pulses)
    setSignals(null)
    setLive(null)
    setError(null)
    setRunning(true)
    try {
      const result = await probeLight({
        video,
        track: stream?.getVideoTracks()[0],
        pulses: next.pulses,
        durationMs: next.durationMs,
        signal: controller.signal,
        onFrame: setLive,
      })
      setSignals(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  const face = signals ? pulses.map((p) => read(signals.frames, p, 'face')) : []
  const surround = signals ? pulses.map((p) => read(signals.frames, p, 'surround')) : []

  return (
    <details style={{ marginTop: 24 }}>
      <summary style={{ cursor: 'pointer' }}>Light Lab (하드웨어 점검)</summary>

      <video ref={videoRef} autoPlay playsInline muted style={{ display: 'none' }} />

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '12px 0' }}>
        <button onClick={start} disabled={!stream || running}>
          {running ? '측정 중…' : '빛 반사 측정'}
        </button>
        <button onClick={() => abortRef.current?.abort()} disabled={!running}>
          중지
        </button>
        {live && (
          <span className="tabular" style={{ fontSize: 13, opacity: 0.8 }}>
            face {fmt(level(live.face))} · surround {fmt(level(live.surround))} · clipped{' '}
            {fmt(live.face.clipped * 100, 0)}%
          </span>
        )}
      </div>

      {error && <p style={{ color: 'crimson' }}>{error}</p>}

      {signals && (
        <>
          <p className="tabular" style={{ fontSize: 13 }}>
            {signals.frames.length} frames @ {fmt(fps(signals.frames), 0)} fps · clock{' '}
            <b>{signals.videoClock}</b> · exposure {signals.cameraModes?.exposure ?? 'unknown'} ·
            white balance {signals.cameraModes?.whiteBalance ?? 'unknown'}
          </p>
          <table className="tabular" style={{ fontSize: 13, borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {['', 'pulse', 'face Δ', 'face depth', 'decay', 'scene Δ', 'scene depth', 'frames'].map(
                  (h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '2px 10px 2px 0' }}>
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {face.map((f, i) => (
                <tr key={i}>
                  <td style={{ padding: '2px 10px 2px 0' }}>
                    <span
                      style={{
                        display: 'inline-block',
                        width: 12,
                        height: 12,
                        background: f.color,
                        border: '1px solid #444',
                      }}
                    />
                  </td>
                  <td style={{ padding: '2px 10px 2px 0' }}>{f.color}</td>
                  <td style={{ padding: '2px 10px 2px 0' }}>{fmt(f.delta)}</td>
                  <td style={{ padding: '2px 10px 2px 0' }}>{fmt(f.depth * 100)}%</td>
                  <td style={{ padding: '2px 10px 2px 0' }}>{fmt(f.decay)}</td>
                  <td style={{ padding: '2px 10px 2px 0' }}>{fmt(surround[i]!.delta)}</td>
                  <td style={{ padding: '2px 10px 2px 0' }}>{fmt(surround[i]!.depth * 100)}%</td>
                  <td style={{ padding: '2px 10px 2px 0' }}>{f.frames}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: 12, opacity: 0.7, maxWidth: 560 }}>
            판정은 서버가 합니다. 여기 숫자는 계측값입니다 — depth가 1% 아래로 깔리면 이 기기·이 방에서
            light는 판정에 도달하지 못하고, decay가 1보다 많이 작으면 카메라 노출 보정이 플래시를 깎고
            있다는 뜻입니다.
          </p>
        </>
      )}
    </details>
  )
}

/** Six pulses in six distinct colors at jittered onsets, as the server issues. */
function schedule(): { pulses: LightPulse[]; durationMs: number } {
  const colors = [...PALETTE].sort(() => Math.random() - 0.5).slice(0, 6)
  const pulses: LightPulse[] = []
  let cursor = LEAD_IN_MS
  for (const color of colors) {
    pulses.push({ atMs: cursor, holdMs: HOLD_MS, color })
    cursor += HOLD_MS + GAP_MIN_MS + Math.floor(Math.random() * GAP_JITTER_MS)
  }
  return { pulses, durationMs: cursor }
}

/**
 * One pulse's response, the same way the verifier measures it: the region's
 * movement along the pulse's own color against the dark frames either side.
 *
 * Without the lag correction the verifier applies — this is a bring-up
 * instrument and the pipeline delay is one of the things it is here to reveal,
 * so a delta that looks small here with `callback` in the clock readout may
 * simply be mistimed rather than absent.
 */
function read(frames: LightFrame[], pulse: LightPulse, region: 'face' | 'surround'): PulseReading {
  const unit = unitColor(pulse.color)
  const project = (f: LightFrame) =>
    f[region].r * unit.r + f[region].g * unit.g + f[region].b * unit.b
  const between = (lo: number, hi: number) => frames.filter((f) => f.t >= lo && f.t < hi)

  const start = pulse.atMs + GUARD_MS
  const end = pulse.atMs + pulse.holdMs
  const mid = (start + end) / 2
  const on = between(start, end)
  const off = [
    ...between(pulse.atMs - GUARD_MS - pulse.holdMs, pulse.atMs - GUARD_MS),
    ...between(end + GUARD_MS, end + GUARD_MS + pulse.holdMs),
  ]
  if (on.length === 0 || off.length === 0) {
    return { color: pulse.color, delta: NaN, depth: NaN, decay: NaN, frames: on.length }
  }

  const baseline = avg(off.map(project))
  const delta = avg(on.map(project)) - baseline
  const front = between(start, mid).map(project)
  const back = between(mid, end).map(project)
  return {
    color: pulse.color,
    delta,
    depth: baseline > 0 ? delta / baseline : NaN,
    decay:
      front.length > 0 && back.length > 0 && avg(front) - baseline !== 0
        ? (avg(back) - baseline) / (avg(front) - baseline)
        : NaN,
    frames: on.length,
  }
}

function unitColor(color: string) {
  const raw = {
    r: Number.parseInt(color.slice(1, 3), 16),
    g: Number.parseInt(color.slice(3, 5), 16),
    b: Number.parseInt(color.slice(5, 7), 16),
  }
  const norm = Math.hypot(raw.r, raw.g, raw.b) || 1
  return { r: raw.r / norm, g: raw.g / norm, b: raw.b / norm }
}

function level(roi: { r: number; g: number; b: number }): number {
  return (roi.r + roi.g + roi.b) / 3
}

function avg(xs: number[]): number {
  return xs.length === 0 ? NaN : xs.reduce((s, x) => s + x, 0) / xs.length
}

function fps(frames: LightFrame[]): number {
  if (frames.length < 2) return 0
  const span = frames[frames.length - 1]!.t - frames[0]!.t
  return span > 0 ? ((frames.length - 1) * 1000) / span : 0
}

function fmt(x: number, digits = 2): string {
  return Number.isFinite(x) ? x.toFixed(digits) : '—'
}
