import { ArrowRight, CalendarClock, KeyRound, UserRound } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { TitleBar } from '../interviewer/TitleBar.tsx'
import { findRoom, formatRoomTime, type Room } from '../rooms.ts'

const ERRORS = {
  unknown: 'No room with this code.',
  format: 'Room codes are 6 characters, like QX7-M4K.',
} as const

export function CodeEntry({ onContinue }: { onContinue: (room: Room) => void }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [room, setRoom] = useState<Room | null>(null)

  function submit(e: FormEvent) {
    e.preventDefault()
    const found = findRoom(code)
    if (found.ok) {
      setRoom(found.room)
      setError(null)
    } else {
      setRoom(null)
      setError(ERRORS[found.error])
    }
  }

  return (
    <div className="app app--ended">
      <TitleBar title="Knock" />
      <div className="entry">
        <form className="entry__card" onSubmit={submit} noValidate>
          <span className="brand__logo brand__logo--lg">
            <KeyRound size={22} aria-hidden />
          </span>
          <h1>Join a Knock room</h1>
          <p className="muted">Enter the code from your invitation.</p>

          <label className="entry__field">
            <span>Enter room code</span>
            <input
              value={code}
              onChange={(e) => {
                setCode(e.target.value.toUpperCase())
                setError(null)
                setRoom(null)
              }}
              placeholder="QX7-M4K"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              maxLength={9}
              aria-invalid={error !== null}
              aria-describedby={error ? 'code-error' : undefined}
            />
          </label>
          {error && (
            <p id="code-error" className="entry__error" role="alert">
              {error}
            </p>
          )}

          {room ? (
            <div className="entry__room">
              <div className="entry__room-title">{room.title}</div>
              <div className="entry__room-meta">
                <CalendarClock size={14} aria-hidden /> {formatRoomTime(room)}
              </div>
              <div className="entry__room-meta">
                <UserRound size={14} aria-hidden /> Hosted by {room.host.name} ({room.host.role})
              </div>
              <button type="button" className="button button--accent button--block" onClick={() => onContinue(room)}>
                Continue to device check <ArrowRight size={15} aria-hidden />
              </button>
            </div>
          ) : (
            <button type="submit" className="button button--accent button--block" disabled={code.trim() === ''}>
              Find room
            </button>
          )}
        </form>
      </div>
    </div>
  )
}
