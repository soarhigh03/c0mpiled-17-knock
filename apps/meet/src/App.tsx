import { useEffect, useRef, useState } from 'react'
import { createKnock, type CheckResult, type Verdict } from '@knock/sdk'
import './App.css'

const knock = createKnock({
  apiUrl: import.meta.env.VITE_KNOCK_API_URL ?? 'http://localhost:8787',
})

function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [results, setResults] = useState<CheckResult[]>([])
  const [verdict, setVerdict] = useState<Verdict | null>(null)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => knock.watchEnvironment(), [])

  async function startCamera() {
    const s = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    setStream(s)
    if (videoRef.current) videoRef.current.srcObject = s
  }

  async function runVerification() {
    if (!stream || !videoRef.current) return
    setRunning(true)
    setResults([])
    setVerdict(null)
    setError(null)
    try {
      await document.documentElement.requestFullscreen().catch(() => {})
      const res = await knock.verify(['environment', 'light', 'sonar'], {
        stream,
        video: videoRef.current,
        onResult: (r) => setResults((prev) => [...prev, r]),
      })
      setVerdict(res.verdict)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setRunning(false)
    }
  }

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: 16, textAlign: 'left' }}>
      <h1>Knock Meet</h1>
      <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', background: '#000' }} />
      <div style={{ display: 'flex', gap: 8, margin: '12px 0' }}>
        <button onClick={startCamera} disabled={!!stream}>카메라 켜기</button>
        <button onClick={runVerification} disabled={!stream || running}>
          {running ? '검증 중…' : '사람 검증 시작'}
        </button>
      </div>
      {error && <p style={{ color: 'crimson' }}>{error}</p>}
      <ul>
        {results.map((r) => (
          <li key={r.kind}>
            <b>{r.kind}</b>: {r.status} ({r.score.toFixed(2)}) {r.reasons.join(' / ')}
          </li>
        ))}
      </ul>
      {verdict && (
        <p>
          최종: <b>{verdict.human ? 'HUMAN' : 'NOT VERIFIED'}</b> (score {verdict.score.toFixed(2)})
        </p>
      )}
    </main>
  )
}

export default App
