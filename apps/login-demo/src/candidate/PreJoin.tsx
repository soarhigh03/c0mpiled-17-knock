import {
  Camera,
  CircleCheck,
  Mic,
  Monitor,
  ShieldCheck,
  TriangleAlert,
  Workflow,
  type LucideIcon,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { matchNativeDevice, normalizeLabel } from '../environment/evidence.ts'
import { useContentProtection, useNativeEnvironment } from '../environment/hooks.ts'
import { describeProcesses } from '../environment/processes.ts'
import { CAPTURE_PROTECTION_LIMIT } from '../environment/protection.ts'
import type { Classification, NativeDevice, NativeEnvironment } from '../environment/types.ts'
import { useStreamBinding } from '../environment/useStreamBinding.ts'
import { INTERVIEWER_NAME } from '../interviewer/participants.ts'
import { Pill } from '../interviewer/Pill.tsx'
import type { Tone } from '../interviewer/present.ts'
import { TitleBar } from '../interviewer/TitleBar.tsx'
import { VideoView } from '../interviewer/VideoView.tsx'

type RowStatus = 'ok' | 'blocked' | 'quit' | 'review' | 'on' | 'off'

const PILL: Record<RowStatus, { tone: Tone; text: string }> = {
  ok: { tone: 'pass', text: 'OK' },
  blocked: { tone: 'fail', text: 'Blocked' },
  quit: { tone: 'fail', text: 'Quit app' },
  review: { tone: 'review', text: 'Review' },
  on: { tone: 'pass', text: 'On' },
  off: { tone: 'muted', text: 'Off' },
}

interface Row {
  id: string
  icon: LucideIcon
  title: string
  detail: string
  status: RowStatus
}

const NO_NATIVE: Classification = { verdict: 'review', reason: 'Native device check needs the Knock desktop app' }

function classifyByLabel(label: string, natives: NativeDevice[] | undefined): Classification {
  if (!natives) return NO_NATIVE
  return matchNativeDevice(label, natives)?.classification ?? { verdict: 'review', reason: 'Not found in the native device list' }
}

function statusOf(c: Classification): RowStatus {
  return c.verdict === 'allowed' ? 'ok' : c.verdict === 'blocked' ? 'blocked' : 'review'
}

function environmentRows(env: NativeEnvironment | null, protectedNow: boolean): Row[] {
  const processes = env?.suspiciousProcesses ?? []
  const displays = env?.displays.length ?? 0
  return [
    {
      id: 'input-path',
      icon: Workflow,
      title: 'Input path',
      detail: env ? describeProcesses(processes) : NO_NATIVE.reason,
      status: !env ? 'review' : processes.length > 0 ? 'quit' : 'ok',
    },
    {
      id: 'display',
      icon: Monitor,
      title: 'Display',
      detail: !env ? NO_NATIVE.reason : displays === 1 ? '1 display' : `${displays} displays connected — use one display`,
      status: !env || displays !== 1 ? 'review' : 'ok',
    },
    {
      id: 'secure',
      icon: ShieldCheck,
      title: 'Secure mode',
      detail: protectedNow
        ? 'Capture protection on — some macOS recorders (ScreenCaptureKit) can still capture'
        : 'Screen capture allowed (dev)',
      status: protectedNow ? 'on' : 'off',
    },
  ]
}

export function PreJoin() {
  const env = useNativeEnvironment()
  const protectedNow = useContentProtection()
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [cameraId, setCameraId] = useState<string | null>(null)
  const [micId, setMicId] = useState<string | null>(null)
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [joined, setJoined] = useState(false)

  const refreshDevices = useCallback(async () => {
    setDevices(await navigator.mediaDevices.enumerateDevices())
  }, [])

  // One permission prompt up front so device labels are available; preview streams are opened per selection.
  useEffect(() => {
    let cancelled = false
    navigator.mediaDevices
      .getUserMedia({ video: true, audio: true })
      .then(async (s) => {
        const [video] = s.getVideoTracks()
        const [audio] = s.getAudioTracks()
        s.getTracks().forEach((t) => t.stop())
        if (cancelled) return
        setCameraId(video?.getSettings().deviceId ?? null)
        setMicId(audio?.getSettings().deviceId ?? null)
        await refreshDevices()
      })
      .catch((e: unknown) => {
        if (!cancelled) setMediaError(e instanceof Error ? e.message : String(e))
      })
    navigator.mediaDevices.addEventListener('devicechange', refreshDevices)
    return () => {
      cancelled = true
      navigator.mediaDevices.removeEventListener('devicechange', refreshDevices)
    }
  }, [refreshDevices])

  const cameras = devices.filter((d) => d.kind === 'videoinput')
  const mics = devices.filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')
  const selectedCamera = cameras.find((d) => d.deviceId === cameraId) ?? null
  const selectedMic = mics.find((d) => d.deviceId === micId) ?? mics[0] ?? null
  const cameraClass = selectedCamera ? classifyByLabel(selectedCamera.label, env?.cameras) : null
  const micClass = selectedMic ? classifyByLabel(selectedMic.label, env?.microphones) : null
  const cameraBlocked = cameraClass?.verdict === 'blocked'
  const micBlocked = micClass?.verdict === 'blocked'

  const firstAllowedCamera = cameras.find((d) => classifyByLabel(d.label, env?.cameras).verdict === 'allowed') ?? null

  // Never open a blocked device; the preview shows the blocked panel instead.
  const selectedMicId = selectedMic?.deviceId ?? null
  useEffect(() => {
    if (!cameraId || joined) return
    const wantVideo = !cameraBlocked
    const wantAudio = selectedMicId !== null && !micBlocked
    if (!wantVideo && !wantAudio) return
    let cancelled = false
    let opened: MediaStream | null = null
    navigator.mediaDevices
      .getUserMedia({
        video: wantVideo ? { deviceId: { exact: cameraId }, width: 1280, height: 720 } : false,
        audio: wantAudio ? { deviceId: { exact: selectedMicId } } : false,
      })
      .then((s) => {
        if (cancelled) {
          s.getTracks().forEach((t) => t.stop())
          return
        }
        opened = s
        setStream(s)
      })
      .catch((e: unknown) => {
        if (!cancelled) setMediaError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
      opened?.getTracks().forEach((t) => t.stop())
      setStream(null)
    }
  }, [cameraId, cameraBlocked, selectedMicId, micBlocked, joined])

  // The live track label must match an allowed device, not just the selector.
  const binding = useStreamBinding(stream, env)
  const liveCamera = binding.camera && stream?.getVideoTracks().length ? binding.camera : cameraClass
  const liveMic = binding.microphone && stream?.getAudioTracks().length ? binding.microphone : micClass

  const rows: Row[] = [
    {
      id: 'camera',
      icon: Camera,
      title: 'Camera',
      detail: selectedCamera && liveCamera ? `${normalizeLabel(selectedCamera.label)} — ${liveCamera.reason}` : 'No camera selected',
      status: liveCamera ? statusOf(liveCamera) : 'blocked',
    },
    {
      id: 'microphone',
      icon: Mic,
      title: 'Microphone',
      detail: selectedMic && liveMic ? `${normalizeLabel(selectedMic.label)} — ${liveMic.reason}` : 'No microphone selected',
      status: liveMic ? statusOf(liveMic) : 'blocked',
    },
    ...environmentRows(env, protectedNow),
  ]
  const blocking = rows.some((r) => r.status === 'blocked' || r.status === 'quit')

  const optionLabel = (d: MediaDeviceInfo, natives: NativeDevice[] | undefined) => {
    const verdict = classifyByLabel(d.label, natives).verdict
    const suffix = verdict === 'blocked' ? ' — virtual device' : verdict === 'review' ? ' — needs review' : ''
    return `${normalizeLabel(d.label) || 'Unnamed device'}${suffix}`
  }

  if (joined) {
    return (
      <div className="app app--ended">
        <TitleBar title={`Knock · Interview with ${INTERVIEWER_NAME}`} />
        <div className="left-call">
          <CircleCheck size={28} aria-hidden />
          <h1>You're in</h1>
          <p className="muted">{INTERVIEWER_NAME} will start the interview shortly.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app app--ended">
      <TitleBar title={`Knock · Interview with ${INTERVIEWER_NAME}`} />
      <div className="prejoin">
        <section className="prejoin__main">
          <header>
            <h1>Check your camera and mic</h1>
            <p className="muted">{INTERVIEWER_NAME} is waiting. Knock checks your devices before you join.</p>
          </header>

          <div className="preview">
            {cameraBlocked && selectedCamera ? (
              <div className="preview__blocked" role="alert">
                <TriangleAlert size={28} aria-hidden />
                <strong>Camera blocked</strong>
                <p>
                  “{normalizeLabel(selectedCamera.label)}” is a virtual device. Knock only accepts a built-in or USB camera.
                </p>
                <button
                  type="button"
                  className="button button--accent"
                  disabled={!firstAllowedCamera}
                  onClick={() => firstAllowedCamera && setCameraId(firstAllowedCamera.deviceId)}
                >
                  {firstAllowedCamera ? `Switch to ${normalizeLabel(firstAllowedCamera.label)}` : 'No built-in or USB camera found'}
                </button>
              </div>
            ) : stream && stream.getVideoTracks().length > 0 ? (
              <VideoView stream={stream} mirrored />
            ) : (
              <div className="preview__blocked preview__blocked--idle">
                <Camera size={26} aria-hidden />
                <span>{mediaError ? `Camera unavailable — ${mediaError}` : 'Starting camera…'}</span>
              </div>
            )}
            {liveCamera?.verdict === 'review' && !cameraBlocked && (
              <div className="preview__note">
                <TriangleAlert size={14} aria-hidden />
                <span>{liveCamera.reason}</span>
                {firstAllowedCamera && firstAllowedCamera.deviceId !== cameraId && (
                  <button type="button" className="toast__action" onClick={() => setCameraId(firstAllowedCamera.deviceId)}>
                    Switch to {normalizeLabel(firstAllowedCamera.label)}
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="selectors">
            <label className="select-field">
              <span>
                <Camera size={14} aria-hidden /> Camera
              </span>
              <select value={cameraId ?? ''} onChange={(e) => setCameraId(e.target.value)}>
                {cameras.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {optionLabel(d, env?.cameras)}
                  </option>
                ))}
              </select>
            </label>
            <label className="select-field">
              <span>
                <Mic size={14} aria-hidden /> Microphone
              </span>
              <select value={selectedMic?.deviceId ?? ''} onChange={(e) => setMicId(e.target.value)}>
                {mics.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {optionLabel(d, env?.microphones)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>

        <aside className="device-card" aria-label="Device check">
          <h2>Device check</h2>
          <ul className="checks">
            {rows.map((row) => {
              const pill = PILL[row.status]
              const Icon = row.icon
              return (
                <li
                  key={row.id}
                  className={pill.tone === 'fail' ? 'check-row check-row--fail' : 'check-row'}
                  title={row.id === 'secure' && protectedNow ? CAPTURE_PROTECTION_LIMIT : undefined}
                >
                  <span className={`check-row__icon check-row__icon--${pill.tone}`}>
                    <Icon size={16} aria-hidden />
                  </span>
                  <div className="check-row__text">
                    <div className="check-row__title">{row.title}</div>
                    <div className="check-row__detail">{row.detail}</div>
                  </div>
                  <Pill tone={pill.tone}>{pill.text}</Pill>
                </li>
              )
            })}
          </ul>

          <div className="consent">
            During the interview Knock may briefly change your screen color, play an inaudible tone, and ask you to
            read a short phrase. Only the signals needed for these checks are sent for verification.
          </div>

          <button
            type="button"
            className="button button--accent button--block"
            disabled={blocking || !selectedCamera}
            onClick={() => setJoined(true)}
          >
            Join interview
          </button>
          {blocking && <p className="device-card__hint">Fix the blocked items above to join.</p>}
        </aside>
      </div>
    </div>
  )
}
