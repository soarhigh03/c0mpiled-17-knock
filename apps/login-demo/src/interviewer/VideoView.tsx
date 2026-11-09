import { useEffect, useRef } from 'react'

export function VideoView({ stream, mirrored }: { stream: MediaStream; mirrored?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream
  }, [stream])
  return <video ref={ref} autoPlay playsInline muted className={mirrored ? 'video video--mirrored' : 'video'} />
}
