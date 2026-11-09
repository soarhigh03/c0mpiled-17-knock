import { Ellipsis, ShieldCheck, PanelRight, VideoOff } from 'lucide-react'
import { useState } from 'react'
import type { OverallVerdict } from '../knock/types.ts'
import { displayName, initials, type Participant } from './participants.ts'
import { shortStatus } from './present.ts'
import { VideoView } from './VideoView.tsx'

interface VideoTileProps {
  participant: Participant
  verdict: OverallVerdict
  selected: boolean
  stream: MediaStream | null
  /** Only meaningful for your own tile. */
  cameraOn: boolean
  onSelect: () => void
  /** Absent for your own tile: Knock checks other participants. */
  onCheckNow?: () => void
  onViewInKnock: () => void
}

export function VideoTile(props: VideoTileProps) {
  const { participant, verdict, selected, stream } = props
  const [menuOpen, setMenuOpen] = useState(false)
  const status = shortStatus(verdict)
  const usesCamera = participant.video !== 'avatar'
  const showVideo = usesCamera && stream && (participant.video !== 'self' || props.cameraOn)

  return (
    <div
      className={`tile tile--${status.tone}${selected ? ' tile--selected' : ''}`}
      onMouseLeave={() => setMenuOpen(false)}
    >
      {showVideo ? (
        <VideoView stream={stream} mirrored={participant.video === 'self'} />
      ) : (
        <div className="tile__avatar-wrap">
          <div className="avatar" style={{ background: participant.avatarColor }}>
            {participant.video === 'self' && !props.cameraOn ? <VideoOff size={26} aria-hidden /> : initials(participant.name)}
          </div>
        </div>
      )}

      {/* Clicking anywhere on the tile selects it; menu and badges sit above this layer. */}
      <button
        type="button"
        className="tile__select"
        aria-label={`Show ${participant.name} in Knock`}
        aria-pressed={selected}
        onClick={props.onSelect}
      />

      <div className={`badge badge--sm badge--${status.tone}`}>
        <span className="dot" aria-hidden />
        {status.text}
      </div>

      <div className={menuOpen ? 'tile__menu is-open' : 'tile__menu'}>
        <button
          type="button"
          className="tile__menu-button"
          aria-label={`${participant.name} options`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          <Ellipsis size={16} />
        </button>
        {menuOpen && (
          <div className="menu" role="menu">
            <button
              type="button"
              role="menuitem"
              disabled={!props.onCheckNow || verdict.status === 'checking'}
              title={props.onCheckNow ? undefined : 'Knock checks other participants'}
              onClick={() => {
                setMenuOpen(false)
                props.onCheckNow?.()
              }}
            >
              <ShieldCheck size={14} aria-hidden />
              Check now
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setMenuOpen(false)
                props.onViewInKnock()
              }}
            >
              <PanelRight size={14} aria-hidden />
              View in Knock
            </button>
          </div>
        )}
      </div>

      <div className="tile__name">{displayName(participant)}</div>
      {participant.video === 'local-demo' && (
        <div className="todo-chip" title="TODO(webrtc): replace with this participant's remote stream">
          Local camera · WebRTC TODO
        </div>
      )}
    </div>
  )
}
