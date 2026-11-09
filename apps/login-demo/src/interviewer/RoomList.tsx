import { CalendarClock, Play, ShieldCheck, Users } from 'lucide-react'
import { CHECK_LABEL } from '../knock/checks.ts'
import { formatRoomTime, ROOMS, type Room } from '../rooms.ts'
import { TitleBar } from './TitleBar.tsx'

/** Interviewer start screen: pick a (demo) room to host. */
export function RoomList({ onStart }: { onStart: (room: Room) => void }) {
  return (
    <div className="app app--ended">
      <TitleBar title="preSense" />
      <div className="rooms">
        <header>
          <h1>Your rooms</h1>
          <p className="muted">Start a room, then give your guest its code.</p>
        </header>
        <ul className="rooms__list">
          {ROOMS.map((room) => (
            <li key={room.code} className="room-card">
              <div className="room-card__main">
                <div className="room-card__title">{room.title}</div>
                <div className="room-card__meta">
                  <CalendarClock size={14} aria-hidden /> {formatRoomTime(room)}
                </div>
                <div className="room-card__meta">
                  <Users size={14} aria-hidden /> {room.host.name} ({room.host.role}) · {room.guest.name} (
                  {room.guest.role})
                </div>
                <div className="room-card__meta">
                  <ShieldCheck size={14} aria-hidden /> {room.checks.map((k) => CHECK_LABEL[k]).join(' · ')}
                </div>
              </div>
              <div className="room-card__side">
                <div className="room-card__code" aria-label={`Room code ${room.display}`}>
                  {room.display}
                </div>
                <button type="button" className="button button--accent" onClick={() => onStart(room)}>
                  <Play size={14} aria-hidden /> Start room
                </button>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
