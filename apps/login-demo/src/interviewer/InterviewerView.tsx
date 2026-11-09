import { PhoneOff } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useKnockClients, useKnockStates } from '../knock/useKnock.ts'
import { effectiveVerdict } from '../knock/verdict.ts'
import { ControlBar } from './ControlBar.tsx'
import { useLocalCamera, useNow } from './hooks.ts'
import { KnockPanel } from './KnockPanel.tsx'
import type { RoomLink } from '../room/link.ts'
import { useRoomMedia } from '../room/useRoomMedia.ts'
import type { Room } from '../rooms.ts'
import { GUEST_ID, type Participant } from './participants.ts'
import { aggregateTone, formatElapsed } from './present.ts'
import { ReportModal } from './ReportModal.tsx'
import { TitleBar } from './TitleBar.tsx'
import { Toasts } from './Toasts.tsx'
import { useKnockAlerts, type CallAlert } from './useKnockAlerts.ts'
import { VideoTile } from './VideoTile.tsx'

interface InterviewerViewProps {
  room: Room
  participants: Participant[]
  link: RoomLink
  onLeave: () => void
}

export function InterviewerView({ room, participants, link, onLeave }: InterviewerViewProps) {
  const clients = useKnockClients()
  const states = useKnockStates(clients)
  const now = useNow()
  const [callStartedAt, setCallStartedAt] = useState(() => Date.now())
  const [micOn, setMicOn] = useState(true)
  const [cameraOn, setCameraOn] = useState(true)
  const [ended, setEnded] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)
  const [selectedId, setSelectedId] = useState(GUEST_ID)
  const [reportOpen, setReportOpen] = useState(false)
  const [toasts, setToasts] = useState<CallAlert[]>([])
  const autoOpened = useRef(false)

  const { stream } = useLocalCamera()
  const { remote, status } = useRoomMedia(link, stream)
  // A transport that cannot carry media has no guest video to show, and the
  // guest tile falls back to an avatar rather than showing your own camera
  // twice. Over a peer link the guest tile is the guest.
  const guestStream = link.carriesMedia ? remote : null

  // Re-derived every tick so a pass flips to "expired" on time even if a client is late to emit.
  const verdicts = Object.fromEntries(
    participants.map((p) => [p.id, effectiveVerdict(states[p.id].verdict, now)]),
  )
  const selected = participants.find((p) => p.id === selectedId) ?? participants[0]

  const onAlert = useCallback((alert: CallAlert) => {
    setToasts((prev) => [alert, ...prev.filter((t) => t.participantId !== alert.participantId)].slice(0, 3))
    // First failure in the session opens the panel on that participant.
    if (alert.tone === 'fail' && !autoOpened.current) {
      autoOpened.current = true
      setSelectedId(alert.participantId)
      setPanelOpen(true)
    }
  }, [])
  useKnockAlerts(clients, participants, onAlert)

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
        <TitleBar title={`preSense · ${room.title}`} />
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
          <button type="button" className="button button--outline" onClick={onLeave}>
            Back to rooms
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="app">
      <TitleBar
        title={`preSense · ${room.title}`}
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
          {/* A remote call that silently fails to connect looks exactly like a
              candidate who has not joined. Say which it is. */}
          {link.carriesMedia && status.state !== 'connected' && (
            <div className={status.state === 'error' ? 'link-status link-status--error' : 'link-status'} role="status">
              {status.state === 'error'
                ? status.message
                : `Waiting for ${room.guest.name} to join this room…`}
            </div>
          )}
          <div className="grid" data-count={participants.length}>
            {participants.map((p) => (
              <VideoTile
                key={p.id}
                participant={p}
                verdict={verdicts[p.id]}
                selected={p.id === selectedId}
                stream={p.isSelf ? stream : guestStream}
                cameraOn={cameraOn}
                onSelect={() => setSelectedId(p.id)}
                onCheckNow={p.isSelf ? undefined : () => clients[p.id].requestCheck()}
                onViewInKnock={() => openInKnock(p.id)}
              />
            ))}
          </div>
        </main>
        {panelOpen && (
          <KnockPanel
            participants={participants}
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
          room={room}
          state={states[selected.id]}
          verdict={verdicts[selected.id]}
          now={now}
          onClose={closeReport}
        />
      )}
    </div>
  )
}
