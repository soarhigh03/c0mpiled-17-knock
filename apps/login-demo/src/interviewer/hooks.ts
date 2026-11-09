import { useEffect, useState } from 'react'

/** Re-renders on an interval so countdowns and "Ns ago" stay live. */
export function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

/** Local camera stream, shared by every tile that shows it. */
export function useLocalCamera(): { stream: MediaStream | null; error: string | null } {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let acquired: MediaStream | null = null
    navigator.mediaDevices
      .getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        acquired = s
        setStream(s)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
      acquired?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return { stream, error }
}
