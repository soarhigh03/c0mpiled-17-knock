import type { ChallengeKind } from '@knock/shared'

/**
 * DEMO DATA. There is no rooms API yet; these two rooms are hard-coded so the
 * interviewer and candidate windows can find each other by code.
 */

export interface RoomPerson {
  name: string
  role: string
}

export interface Room {
  /** Canonical code: 6 chars from ROOM_CODE_ALPHABET. */
  code: string
  /** How the code is shown and read out, e.g. "QX7-M4K". */
  display: string
  title: string
  /** ISO 8601 with the KST offset. */
  scheduledAt: string
  host: RoomPerson
  guest: RoomPerson
  checks: ChallengeKind[]
}

/** No 0/O, 1/I/L: codes are read aloud and typed by hand. */
export const ROOM_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export const ROOMS: readonly Room[] = [
  {
    code: 'QX7M4K',
    display: 'QX7-M4K',
    title: 'Acme Design · Product Designer final interview',
    scheduledAt: '2026-11-10T10:00:00+09:00',
    host: { name: 'Eunwoo Choi', role: 'Interviewer' },
    guest: { name: 'Byungho Park', role: 'Candidate' },
    checks: ['environment', 'light', 'sonar', 'voice'],
  },
  {
    code: 'R9T2HF',
    display: 'R9T-2HF',
    title: 'Orbit Finance · International transfer approval call',
    scheduledAt: '2026-11-10T14:30:00+09:00',
    host: { name: 'Eunwoo Choi', role: 'Finance lead' },
    guest: { name: 'Byungho Park', role: 'Vendor contact' },
    checks: ['environment', 'light', 'sonar', 'voice'],
  },
]

/** Case-insensitive; dashes and spaces are optional. */
export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '')
}

export type RoomLookup = { ok: true; room: Room } | { ok: false; error: 'format' | 'unknown' }

export function findRoom(input: string): RoomLookup {
  const code = normalizeRoomCode(input)
  if (code.length !== 6 || [...code].some((c) => !ROOM_CODE_ALPHABET.includes(c))) {
    return { ok: false, error: 'format' }
  }
  const room = ROOMS.find((r) => r.code === code)
  return room ? { ok: true, room } : { ok: false, error: 'unknown' }
}

export function formatRoomTime(room: Room): string {
  const date = new Date(room.scheduledAt)
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  }).format(date)
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
  return `${day} · ${time} KST`
}
