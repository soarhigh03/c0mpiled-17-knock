import {
  Ellipsis,
  Mic,
  MicOff,
  ScreenShare,
  ShieldCheck,
  Users,
  Video,
  VideoOff,
  type LucideIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import type { Tone } from './present.ts'

interface ControlBarProps {
  micOn: boolean
  cameraOn: boolean
  panelOpen: boolean
  /** Dot on the Knock button; null while nobody has a result. */
  knockTone: Tone | null
  onToggleMic: () => void
  onToggleCamera: () => void
  onToggleKnock: () => void
  onEnd: () => void
}

function BarButton(props: {
  icon: LucideIcon
  label: string
  onClick?: () => void
  pressed?: boolean
  off?: boolean
  badge?: ReactNode
}) {
  const Icon = props.icon
  return (
    <button
      type="button"
      className={`bar-button${props.pressed ? ' is-pressed' : ''}${props.off ? ' is-off' : ''}`}
      aria-pressed={props.pressed}
      onClick={props.onClick}
    >
      <span className="bar-button__icon">
        <Icon size={22} strokeWidth={1.9} aria-hidden />
        {props.badge}
      </span>
      {props.label}
    </button>
  )
}

export function ControlBar(props: ControlBarProps) {
  return (
    <footer className="controlbar">
      <div className="controlbar__side">
        <BarButton icon={props.micOn ? Mic : MicOff} label="Audio" off={!props.micOn} onClick={props.onToggleMic} />
        <BarButton
          icon={props.cameraOn ? Video : VideoOff}
          label="Video"
          off={!props.cameraOn}
          onClick={props.onToggleCamera}
        />
      </div>

      <div className="controlbar__center">
        {/* TODO(call): participants list panel. */}
        <BarButton icon={Users} label="Participants" />
        <BarButton
          icon={ShieldCheck}
          label="preSense"
          pressed={props.panelOpen}
          onClick={props.onToggleKnock}
          badge={props.knockTone && <span className={`bar-button__dot dot--${props.knockTone}`} aria-hidden />}
        />
        <BarButton icon={ScreenShare} label="Share" />
        <BarButton icon={Ellipsis} label="More" />
      </div>

      <div className="controlbar__side controlbar__side--end">
        <button type="button" className="end-button" onClick={props.onEnd}>
          End
        </button>
      </div>
    </footer>
  )
}
