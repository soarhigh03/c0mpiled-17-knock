import { useEffect, useRef, useState } from 'react'
import {
  probeSonar,
  sweepCarrierResponse,
  type CarrierReading,
  type DopplerSample,
  type MouthSample,
  type SweepPoint,
} from '@knock/sdk'

/**
 * Hardware bring-up view: watch the Doppler energy and the mouth aperture
 * live, on this machine, at a carrier of your choosing.
 *
 * Laptop speakers and microphones differ wildly above 18 kHz, so per machine
 * you want to see the tone actually arrive (캐리어 도달 ≫ 0 dB, 톤 순도 high)
 * and Doppler energy that tracks the mouth trace.
 *
 * A high correlation on its own does not prove the sonar works: speech
 * sibilance reaches past 19 kHz and lands straight in the demodulation band,
 * where it correlates with the lips just as well as a real echo would. The
 * control is to mouth the words silently — a correlation that survives that
 * is Doppler; one that collapses was the voice all along.
 *
 * Every number here is a debug instrument. The verdict is server-side.
 */

/** Rolling window drawn and correlated over. */
const WINDOW_MS = 6_000
/** Probes run until stopped; this is just a backstop. */
const MAX_RUN_MS = 5 * 60_000
const GRID_HZ = 20
const MAX_LAG_MS = 300

const DOPPLER_COLOR = '#38bdf8'
const MOUTH_COLOR = '#f472b6'

export function SonarLab({ stream }: { stream: MediaStream | null }) {
  const [carrierHz, setCarrierHz] = useState(randomCarrier)
  const [running, setRunning] = useState(false)
  const [carrier, setCarrier] = useState<CarrierReading | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [stats, setStats] = useState({ dopplerHz: 0, mouthHz: 0, r: 0, lagMs: 0 })
  const [sweep, setSweep] = useState<SweepPoint[] | null>(null)
  const [sweeping, setSweeping] = useState(false)

  const doppler = useRef<DopplerSample[]>([])
  const mouth = useRef<MouthSample[]>([])
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  // The lab reads frames from its own element so it can run independently of
  // the interview view; a stream can feed any number of <video>s.
  useEffect(() => {
    if (videoRef.current && stream) videoRef.current.srcObject = stream
  }, [stream])

  // Samples arrive ~100×/s, far too often to hold in React state. They live in
  // refs; the canvas redraws on its own frames and the readouts poll.
  useEffect(() => {
    if (!running) return
    let frame = 0
    const draw = () => {
      paint(canvasRef.current, doppler.current, mouth.current)
      frame = requestAnimationFrame(draw)
    }
    frame = requestAnimationFrame(draw)

    const timer = setInterval(() => {
      const { r, lagMs } = correlate(doppler.current, mouth.current)
      setStats({
        dopplerHz: rate(doppler.current),
        mouthHz: rate(mouth.current),
        r,
        lagMs,
      })
    }, 250)

    return () => {
      cancelAnimationFrame(frame)
      clearInterval(timer)
    }
  }, [running])

  useEffect(() => () => abortRef.current?.abort(), [])

  async function start() {
    const video = videoRef.current
    if (!video) return
    const controller = new AbortController()
    abortRef.current = controller
    doppler.current = []
    mouth.current = []
    setCarrier(null)
    setError(null)
    setRunning(true)
    try {
      await probeSonar({
        video,
        carrierHz,
        durationMs: MAX_RUN_MS,
        signal: controller.signal,
        onCarrier: setCarrier,
        onDoppler: (s) => push(doppler.current, s),
        onMouth: (s) => push(mouth.current, s),
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      abortRef.current = null
      setRunning(false)
    }
  }

  async function runSweep() {
    const controller = new AbortController()
    abortRef.current = controller
    setSweep([])
    setError(null)
    setSweeping(true)
    try {
      const points: SweepPoint[] = []
      await sweepCarrierResponse({
        signal: controller.signal,
        onPoint: (p) => {
          points.push(p)
          setSweep([...points])
        },
      })
      // Land on the best frequency that actually cleared the room, if any.
      // Picking the plain maximum would happily hand back a noise spike.
      const best = points
        .filter(isSolid)
        .reduce<SweepPoint | null>((a, b) => (a == null || b.arrivalDb > a.arrivalDb ? b : a), null)
      if (best) setCarrierHz(Math.round(best.hz))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      abortRef.current = null
      setSweeping(false)
    }
  }

  return (
    <details style={{ marginTop: 24, border: '1px solid #334155', borderRadius: 8, padding: 12 }}>
      <summary style={{ cursor: 'pointer' }}>Sonar Lab (하드웨어 점검)</summary>

      <p style={{ fontSize: 13, opacity: 0.75 }}>
        노트북마다 확인: <b>캐리어 도달</b>이 0dB보다 확실히 높아야 우리 톤이 실제로 스피커→마이크를
        통과한 것이고, <b>톤 순도</b>가 높아야 그게 순음입니다. 둘 다 0에 가까운데 상관(r)만 높다면
        도플러가 아니라 목소리의 고주파 성분을 재고 있는 것이니, <b>소리 없이 입만 움직여</b> 보세요.
        그때도 r이 유지되어야 진짜 도플러입니다.
      </p>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', margin: '8px 0' }}>
        <label>
          캐리어{' '}
          <input
            type="number"
            min={17000}
            max={22000}
            step={100}
            value={carrierHz}
            disabled={running}
            onChange={(e) => setCarrierHz(Number(e.target.value))}
            style={{ width: 90 }}
          />{' '}
          Hz
        </label>
        <button onClick={() => setCarrierHz(randomCarrier())} disabled={running || sweeping}>
          랜덤
        </button>
        {running || sweeping ? (
          <button onClick={() => abortRef.current?.abort()}>정지</button>
        ) : (
          <>
            <button onClick={start} disabled={!stream}>
              측정 시작
            </button>
            <button onClick={runSweep}>주파수 스윕</button>
          </>
        )}
        {!stream && <span style={{ opacity: 0.7 }}>카메라를 먼저 켜주세요</span>}
        {/* Small, but visible: a hidden <video> gets throttled and stops
            delivering frame callbacks. Doubles as a framing check. */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{ width: 96, borderRadius: 4, background: '#000' }}
        />
      </div>

      <canvas
        ref={canvasRef}
        style={{ width: '100%', height: 200, background: '#0b1220', borderRadius: 6, display: 'block' }}
      />

      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
        <Readout label="캐리어 도달" value={fmtDb(carrier?.snrDb)} />
        <Readout label="톤 순도" value={fmtDb(carrier?.tonalityDb)} />
        <Readout label="도플러" value={`${stats.dopplerHz.toFixed(0)} Hz`} color={DOPPLER_COLOR} />
        <Readout label="입 벌림" value={`${stats.mouthHz.toFixed(0)} fps`} color={MOUTH_COLOR} />
        <Readout label="상관 (디버그)" value={`r=${stats.r.toFixed(2)} @ ${stats.lagMs}ms`} />
      </dl>

      {sweep && <SweepTable points={sweep} running={sweeping} />}

      {error && <p style={{ color: 'crimson' }}>{error}</p>}
    </details>
  )
}

/**
 * Speaker→mic arrival per frequency. The useful reading is the cliff: where
 * the bars stop clearing ~6 dB is this machine's ceiling, and a carrier above
 * it cannot work no matter what the rest of the pipeline does.
 */
function SweepTable({ points, running }: { points: SweepPoint[]; running: boolean }) {
  const solid = points.filter((p) => isSolid(p))
  const noisy = points.filter((p) => p.noiseDb > 6).length
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
        스피커→마이크 도달 / 룸 노이즈 (dB){running && ' — 측정 중, 조용히 해주세요…'}
      </div>
      {!running && noisy > points.length / 3 && (
        <p style={{ fontSize: 12, color: '#fbbf24', margin: '4px 0' }}>
          룸 노이즈가 커서 결과를 믿을 수 없습니다. 조용한 곳에서 다시 재주세요.
        </p>
      )}
      {!running && noisy <= points.length / 3 && solid.length === 0 && (
        <p style={{ fontSize: 12, color: '#fbbf24', margin: '4px 0' }}>
          조용한데도 전 대역이 도달하지 않습니다. 출력 장치·음량·음소거를 확인하세요.
        </p>
      )}
      {points.map((p) => (
        <div key={p.hz} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
          <span style={{ width: 64, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
            {(p.hz / 1000).toFixed(1)} kHz
          </span>
          <span
            style={{
              height: 10,
              borderRadius: 2,
              // Clamped so one strong bar doesn't flatten the rest.
              width: `${Math.min(100, Math.max(0, p.arrivalDb) * 2)}%`,
              background: isSolid(p) ? '#34d399' : '#475569',
            }}
          />
          <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.8 }}>
            {p.arrivalDb.toFixed(1)}
          </span>
          <span style={{ fontVariantNumeric: 'tabular-nums', opacity: 0.45 }}>
            ±{Number.isFinite(p.noiseDb) ? p.noiseDb.toFixed(1) : '—'}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Usable: the tone cleared both the threshold and the room's own wobble. */
function isSolid(p: SweepPoint): boolean {
  return p.arrivalDb >= 6 && p.arrivalDb > p.noiseDb
}

function Readout({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <dt style={{ fontSize: 12, opacity: 0.7, color }}>{label}</dt>
      <dd style={{ margin: 0, fontVariantNumeric: 'tabular-nums' }}>{value}</dd>
    </div>
  )
}

function randomCarrier(): number {
  return 18_000 + Math.round(Math.random() * 20) * 100
}

function fmtDb(db: number | undefined): string {
  return db == null ? '—' : `${db.toFixed(1)} dB`
}

/** Keep only the trailing window; `t` arrives monotonically. */
function push<T extends { t: number }>(buffer: T[], sample: T) {
  buffer.push(sample)
  const cutoff = sample.t - WINDOW_MS
  let drop = 0
  while (drop < buffer.length && buffer[drop]!.t < cutoff) drop++
  if (drop > 0) buffer.splice(0, drop)
}

function rate(series: { t: number }[]): number {
  if (series.length < 2) return 0
  const span = series[series.length - 1]!.t - series[0]!.t
  return span > 0 ? ((series.length - 1) * 1000) / span : 0
}

function paint(canvas: HTMLCanvasElement | null, doppler: DopplerSample[], mouth: MouthSample[]) {
  if (!canvas) return
  const dpr = window.devicePixelRatio || 1
  const w = canvas.clientWidth
  const h = canvas.clientHeight
  if (w === 0 || h === 0) return
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr
    canvas.height = h * dpr
  }

  const g = canvas.getContext('2d')
  if (!g) return
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)

  g.strokeStyle = '#1e293b'
  g.lineWidth = 1
  for (let i = 1; i < 4; i++) {
    const y = (h * i) / 4
    g.beginPath()
    g.moveTo(0, y)
    g.lineTo(w, y)
    g.stroke()
  }

  // The newest sample is "now"; both traces share that right edge.
  const now = Math.max(last(doppler), last(mouth))
  if (!Number.isFinite(now)) return
  // Each trace is auto-scaled to its own range: this view is about whether the
  // shapes agree, not about absolute levels.
  trace(g, w, h, doppler.map((s) => ({ t: s.t, v: s.energy })), now, DOPPLER_COLOR)
  trace(g, w, h, mouth.map((s) => ({ t: s.t, v: s.value })), now, MOUTH_COLOR)
}

function trace(
  g: CanvasRenderingContext2D,
  w: number,
  h: number,
  points: { t: number; v: number }[],
  now: number,
  color: string,
) {
  if (points.length < 2) return
  let min = Infinity
  let max = -Infinity
  for (const p of points) {
    if (p.v < min) min = p.v
    if (p.v > max) max = p.v
  }
  const range = max - min || 1

  g.strokeStyle = color
  g.lineWidth = 1.5
  g.beginPath()
  points.forEach((p, i) => {
    const x = w - ((now - p.t) / WINDOW_MS) * w
    const y = h - 6 - ((p.v - min) / range) * (h - 12)
    if (i === 0) g.moveTo(x, y)
    else g.lineTo(x, y)
  })
  g.stroke()
}

function last(series: { t: number }[]): number {
  return series.length > 0 ? series[series.length - 1]!.t : Number.NEGATIVE_INFINITY
}

/**
 * Debug-only mirror of the server's correlation: resample both series onto a
 * 20 Hz grid, compare Doppler energy against |d(aperture)/dt|, and report the
 * best match within ±300 ms. Handy for telling "this laptop can't hear the
 * carrier" apart from "the carrier is fine, the lag model is off".
 */
function correlate(doppler: DopplerSample[], mouth: MouthSample[]): { r: number; lagMs: number } {
  const from = Math.max(first(doppler), first(mouth))
  const to = Math.min(last(doppler), last(mouth))
  const count = Math.floor(((to - from) * GRID_HZ) / 1000)
  if (!Number.isFinite(count) || count < 8) return { r: 0, lagMs: 0 }

  const times = Array.from({ length: count }, (_, i) => from + (i * 1000) / GRID_HZ)
  const e = at(doppler.map((s) => ({ t: s.t, v: s.energy })), times)
  const m = at(mouth.map((s) => ({ t: s.t, v: s.value })), times)
  const speed = standardise(m.slice(1).map((v, i) => Math.abs(v - m[i]!)))
  const energy = standardise(e.slice(1).map((v, i) => (v + e[i]!) / 2))
  if (!speed || !energy) return { r: 0, lagMs: 0 }

  const maxLag = Math.round((MAX_LAG_MS * GRID_HZ) / 1000)
  let best = { r: 0, lagMs: 0 }
  for (let lag = -maxLag; lag <= maxLag; lag++) {
    const start = Math.max(0, -lag)
    const end = Math.min(speed.length, energy.length - lag)
    if (end - start < 2) continue
    let sum = 0
    for (let i = start; i < end; i++) sum += speed[i]! * energy[i + lag]!
    const r = sum / (end - start)
    if (r > best.r) best = { r, lagMs: Math.round((lag * 1000) / GRID_HZ) }
  }
  return best
}

function first(series: { t: number }[]): number {
  return series.length > 0 ? series[0]!.t : Number.POSITIVE_INFINITY
}

/** Linear interpolation onto `times`, ends held. */
function at(points: { t: number; v: number }[], times: number[]): number[] {
  let i = 0
  return times.map((t) => {
    while (i + 2 < points.length && points[i + 1]!.t <= t) i++
    const a = points[i]!
    const b = points[Math.min(i + 1, points.length - 1)]!
    const span = b.t - a.t
    if (span <= 0) return a.v
    const k = Math.min(1, Math.max(0, (t - a.t) / span))
    return a.v + (b.v - a.v) * k
  })
}

function standardise(xs: number[]): number[] | null {
  if (xs.length < 2) return null
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length
  const std = Math.sqrt(xs.reduce((s, x) => s + (x - mean) ** 2, 0) / xs.length)
  if (!(std > 1e-9)) return null
  return xs.map((x) => (x - mean) / std)
}
