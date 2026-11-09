import type { Room } from '../rooms.ts'

export type VideoSource =
  /** The local camera, mirrored: this is you. */
  | 'self'
  /** The local camera standing in for a remote participant (single-machine demo). */
  | 'local-demo'
  /** No video: initials avatar on a dark tile. */
  | 'avatar'

export interface Participant {
  id: string
  name: string
  role: string
  video: VideoSource
  /** CSS color for the initials avatar. */
  avatarColor: string
  /** The person using this window; Knock checks other participants, not you. */
  isSelf: boolean
}

export const HOST_ID = 'host'
export const GUEST_ID = 'guest'

/** The interviewer window's view of a room: you (host) plus the guest. */
export function roomParticipants(room: Room): Participant[] {
  return [
    { id: HOST_ID, ...room.host, video: 'self', avatarColor: 'var(--avatar-1)', isSelf: true },
    // TODO(webrtc): the guest's remote stream; single-machine demos reuse the local camera.
    { id: GUEST_ID, ...room.guest, video: 'local-demo', avatarColor: 'var(--avatar-2)', isSelf: false },
  ]
}

export function displayName(p: Participant): string {
  return p.isSelf ? `${p.name} (You)` : p.name
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
