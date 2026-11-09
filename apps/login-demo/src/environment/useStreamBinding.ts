import { useEffect, useRef, useState } from 'react'
import { matchNativeDevice } from './evidence.ts'
import type { Classification, NativeEnvironment } from './types.ts'

export interface DeviceMismatch {
  device: 'camera' | 'microphone'
  from: string
  to: string
  reason: string
}

export interface StreamBinding {
  /** Label of the live camera track, or null when there is none. */
  cameraLabel: string | null
  camera: Classification | null
  microphoneLabel: string | null
  microphone: Classification | null
}

const UNKNOWN: Classification = { verdict: 'review', reason: 'Not found in the native device list' }
const POLL_MS = 1000

function classifyTrack(track: MediaStreamTrack | undefined, env: NativeEnvironment | null): Classification | null {
  if (!track) return null
  if (!env) return { verdict: 'review', reason: 'Native device check unavailable' }
  const devices = track.kind === 'video' ? env.cameras : env.microphones
  return matchNativeDevice(track.label, devices)?.classification ?? UNKNOWN
}

/**
 * Ties the live stream to the native device list: each track's label must match
 * a classified device. Afterwards it watches for the stream silently moving to a
 * different device (devicechange, track 'ended', settings.deviceId) and reports
 * each change once via onMismatch.
 */
export function useStreamBinding(
  stream: MediaStream | null,
  env: NativeEnvironment | null,
  onMismatch?: (mismatch: DeviceMismatch) => void,
): StreamBinding {
  const [, setTick] = useState(0)
  const onMismatchRef = useRef(onMismatch)
  useEffect(() => {
    onMismatchRef.current = onMismatch
  }, [onMismatch])

  useEffect(() => {
    if (!stream) return
    type Bound = { track: MediaStreamTrack; deviceId: string | undefined; label: string }
    const bound: Partial<Record<'camera' | 'microphone', Bound>> = {}
    const bind = (device: 'camera' | 'microphone', track: MediaStreamTrack | undefined) => {
      if (track) bound[device] = { track, deviceId: track.getSettings().deviceId, label: track.label }
      else delete bound[device]
    }
    const current = (device: 'camera' | 'microphone') =>
      device === 'camera' ? stream.getVideoTracks()[0] : stream.getAudioTracks()[0]
    bind('camera', current('camera'))
    bind('microphone', current('microphone'))

    const report = (device: 'camera' | 'microphone', to: string, reason: string) => {
      const was = bound[device]
      onMismatchRef.current?.({ device, from: was?.label ?? 'none', to, reason })
      bind(device, current(device))
      setTick((t) => t + 1)
    }

    const check = () => {
      for (const device of ['camera', 'microphone'] as const) {
        const was = bound[device]
        const now = current(device)
        if (!was) {
          if (now) bind(device, now)
          continue
        }
        if (!now) report(device, 'none', `${device === 'camera' ? 'Camera' : 'Microphone'} track removed`)
        else if (now !== was.track) report(device, now.label, 'Stream switched to another track')
        else if (now.readyState === 'ended') report(device, 'none', `${device === 'camera' ? 'Camera' : 'Microphone'} stopped`)
        else if (now.getSettings().deviceId !== was.deviceId) report(device, now.label, 'Track moved to another device')
      }
    }

    const onDeviceChange = async () => {
      const devices = await navigator.mediaDevices.enumerateDevices()
      for (const device of ['camera', 'microphone'] as const) {
        const was = bound[device]
        if (!was?.deviceId) continue
        const kind = device === 'camera' ? 'videoinput' : 'audioinput'
        if (!devices.some((d) => d.kind === kind && d.deviceId === was.deviceId)) {
          report(device, 'none', `${was.label} was disconnected`)
        }
      }
      setTick((t) => t + 1)
    }

    const onEnded = () => check()
    const tracks = stream.getTracks()
    tracks.forEach((t) => t.addEventListener('ended', onEnded))
    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange)
    const timer = setInterval(check, POLL_MS)
    return () => {
      tracks.forEach((t) => t.removeEventListener('ended', onEnded))
      navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange)
      clearInterval(timer)
    }
  }, [stream])

  // setTick re-renders after a reported change so the tracks below are re-read.
  const video = stream?.getVideoTracks()[0]
  const audio = stream?.getAudioTracks()[0]
  return {
    cameraLabel: video?.label ?? null,
    camera: classifyTrack(video, env),
    microphoneLabel: audio?.label ?? null,
    microphone: classifyTrack(audio, env),
  }
}
