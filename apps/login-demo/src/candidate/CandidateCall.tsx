import { PhoneOff, VideoOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNativeEnvironment } from '../environment/hooks.ts'
import { useEnvironmentReporting } from '../environment/useEnvironmentReporting.ts'
import { initials } from '../interviewer/participants.ts'
import type { Room } from '../rooms.ts'
import { TitleBar } from '../interviewer/TitleBar.tsx'
import { VideoView } from '../interviewer/VideoView.tsx'
import type { KnockClient } from '../knock/types.ts'
import { useKnockState } from '../knock/useKnock.ts'
import { ChallengeOverlay } from './ChallengeOverlay.tsx'
import type { JoinSelection } from './PreJoin.tsx'

interface CandidateCallProps extends JoinSelection {
  room: Room
  client: KnockClient
  onLeave: () => void
}

/** The candidate's side of the call. Knock challenges appear over it when the client issues one. */
export function CandidateCall({ room, client, cameraId, micId, onLeave }: CandidateCallProps) {
  const state = useKnockState(client)
  const env = useNativeEnvironment()
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    let opened: MediaStream | null = null
    navigator.mediaDevices
      .getUserMedia({
        video: { deviceId: { exact: cameraId }, width: 1280, height: 720 },
        audio: micId ? { deviceId: { exact: micId } } : true,
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
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
      opened?.getTracks().forEach((t) => t.stop())
    }
  }, [cameraId, micId])

  // The SDK runs its checks on the call's own media.
  useEffect(() => {
    client.attachMedia(stream)
    return () => client.attachMedia(null)
  }, [client, stream])

  // Mid-call device changes go to the client, which marks the result invalid.
  useEnvironmentReporting(client, stream, env)

  return (
    <div className="app app--ended">
      <TitleBar title={`Knock · ${room.title}`} />
      <div className="candidate-call">
        {/* TODO(webrtc): the interviewer's remote video. */}
        <div className="tile candidate-call__remote">
          <div className="tile__avatar-wrap">
            <div className="avatar" style={{ background: 'var(--avatar-1)' }}>
              {initials(room.host.name)}
            </div>
          </div>
          <div className="tile__name">{room.host.name}</div>
          <div className="self-pip">
            {stream ? (
              <VideoView stream={stream} mirrored />
            ) : (
              <div className="pip__off" title={error ?? undefined}>
                <VideoOff size={18} aria-hidden />
              </div>
            )}
            <span className="self-pip__label">You</span>
          </div>
        </div>
        <div className="candidate-call__bar">
          <span className="muted">Interview in progress</span>
          <button type="button" className="end-button" onClick={onLeave}>
            <PhoneOff size={15} aria-hidden /> Leave
          </button>
        </div>
      </div>
      {state.challenge && (
        <ChallengeOverlay key={state.challenge.id} challenge={state.challenge} client={client} stream={stream} />
      )}
    </div>
  )
}
