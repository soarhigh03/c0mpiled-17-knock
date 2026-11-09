import { PhoneOff } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { normalizeLabel, toEnvironmentEvidence } from '../environment/evidence.ts'
import { useNativeEnvironment } from '../environment/hooks.ts'
import { useStreamBinding, type DeviceMismatch } from '../environment/useStreamBinding.ts'
import { useKnockClients, useKnockStates } from '../knock/useKnock.ts'
import { effectiveVerdict } from '../knock/verdict.ts'
import { ControlBar } from './ControlBar.tsx'
import { useLocalCamera, useNow } from './hooks.ts'
import { KnockPanel } from './KnockPanel.tsx'
import { CANDIDATE_ID, PARTICIPANTS, participantName } from './participants.ts'
import { aggregateTone, formatElapsed } from './present.ts'
import { ReportModal } from './ReportModal.tsx'
import { TitleBar } from './TitleBar.tsx'
import { Toasts } from './Toasts.tsx'
import { useKnockAlerts, type CallAlert } from './useKnockAlerts.ts'
import { VideoTile } from './VideoTile.tsx'

const label = (track: MediaStreamTrack | undefined) => (track ? normalizeLabel(track.label) : null)

export function InterviewerView() {
  const clients = useKnockClients()
  const states = useKnockStates(clients)
  const now = useNow()
  const [callStartedAt, setCallStartedAt] = useState(() => Date.now())
  const [micOn, setMicOn] = useState(true)
  const [cameraOn, setCameraOn] = useState(true)
  const [ended, setEnded] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [selectedId, setSelectedId] = useState(CANDIDATE_ID)
  const [reportOpen, setReportOpen] = useState(false)
  const [toasts, setToasts] = useState<CallAlert[]>([])
  const autoOpened = useRef(false)

  // Both "You" and the candidate tile use this until the call transport exists.
  const { stream } = useLocalCamera()

  // TODO(webrtc): this binding belongs on the candidate's machine. For single-machine demos the
  // candidate tile shows the local camera, so its device report goes into the candidate's client.
  const nativeEnv = useNativeEnvironment()
  const candidateClient = clients[CANDIDATE_ID]
  const reportEnvironment = useCallback(
    async (change?: DeviceMismatch) => {
      const devices = await navigator.mediaDevices.enumerateDevices()
      candidateClient.reportEnvironment({
        evidence: toEnvironmentEvidence({
          devices,
          env: nativeEnv,
          isFullscreen: document.fullscreenElement != null,
          userAgent: navigator.userAgent,
        }),
        activeCamera: label(stream?.getVideoTracks()[0]),
        activeMicrophone: label(stream?.getAudioTracks()[0]),
        change: change && { ...change, from: normalizeLabel(change.from), to: normalizeLabel(change.to) },
      })
    },
    [candidateClient, nativeEnv, stream],
  )
  const binding = useStreamBinding(stream, nativeEnv, (mismatch) => void reportEnvironment(mismatch))
  useEffect(() => {
    if (binding.cameraLabel) void reportEnvironment()
  }, [binding.cameraLabel, reportEnvironment])

  // Re-derived every tick so a pass flips to "expired" on time even if a client is late to emit.
  const verdicts = Object.fromEntries(
    PARTICIPANTS.map((p) => [p.id, effectiveVerdict(states[p.id].verdict, now)]),
  )
  const selected = PARTICIPANTS.find((p) => p.id === selectedId) ?? PARTICIPANTS[0]

  const onAlert = useCallback((alert: CallAlert) => {
    setToasts((prev) => [alert, ...prev.filter((t) => t.participantId !== alert.participantId)].slice(0, 3))
    // First failure in the session opens the panel on that participant.
    if (alert.tone === 'fail' && !autoOpened.current) {
      autoOpened.current = true
      setSelectedId(alert.participantId)
      setPanelOpen(true)
    }
  }, [])
  useKnockAlerts(clients, onAlert)

  const dismissToast = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), [])
  const openInKnock = useCallback((participantId: string) => {
    setSelectedId(participantId)
    setPanelOpen(true)
  }, [])
  const closeReport = useCallback(() => setReportOpen(false), [])

  // Alerts about the participant already on screen in the panel would be redundant.
  const visibleToasts = toasts.filter((t) => !(panelOpen && t.participantId === selectedId))

  if (ended) {
    return (
      <div className="app app--ended">
        <TitleBar title={`Knock · Interview with ${participantName(CANDIDATE_ID)}`} />
        <div className="left-call">
          <PhoneOff size={28} aria-hidden />
          <h1>You left the call</h1>
          <button
            type="button"
            className="button button--accent"
            onClick={() => {
              setCallStartedAt(Date.now())
              setEnded(false)
            }}
          >
            Rejoin
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <TitleBar
        title={`Knock · Interview with ${participantName(CANDIDATE_ID)}`}
        elapsed={formatElapsed(now - callStartedAt)}
      />
      <div className={panelOpen ? 'call call--panel' : 'call'}>
        <main className="stage-area">
          <Toasts
            toasts={visibleToasts}
            onDismiss={dismissToast}
            onOpen={(toast) => {
              dismissToast(toast.id)
              openInKnock(toast.participantId)
            }}
          />
          <div className="grid">
            {PARTICIPANTS.map((p) => (
              <VideoTile
                key={p.id}
                participant={p}
                verdict={verdicts[p.id]}
                selected={p.id === selectedId}
                stream={stream}
                cameraOn={cameraOn}
                onSelect={() => setSelectedId(p.id)}
                onCheckNow={() => clients[p.id].requestCheck()}
                onViewInKnock={() => openInKnock(p.id)}
              />
            ))}
          </div>
        </main>
        {panelOpen && (
          <KnockPanel
            participants={PARTICIPANTS}
            verdicts={verdicts}
            selected={selected}
            state={states[selected.id]}
            now={now}
            onSelect={setSelectedId}
            onClose={() => setPanelOpen(false)}
            onRunCheck={() => clients[selected.id].requestCheck()}
            onOpenReport={() => setReportOpen(true)}
          />
        )}
      </div>
      <ControlBar
        micOn={micOn}
        cameraOn={cameraOn}
        panelOpen={panelOpen}
        knockTone={aggregateTone(Object.values(verdicts))}
        onToggleMic={() => setMicOn((v) => !v)}
        onToggleCamera={() => setCameraOn((v) => !v)}
        onToggleKnock={() => setPanelOpen((v) => !v)}
        onEnd={() => setEnded(true)}
      />
      {reportOpen && (
        <ReportModal
          participantName={selected.name}
          state={states[selected.id]}
          verdict={verdicts[selected.id]}
          now={now}
          onClose={closeReport}
        />
      )}
    </div>
  )
}
