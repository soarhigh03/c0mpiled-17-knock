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
}

// Placeholder roster until the call layer exists.
export const PARTICIPANTS: Participant[] = [
  { id: 'you', name: 'You', role: 'Interviewer', video: 'self', avatarColor: 'var(--avatar-1)' },
  // TODO(webrtc): Amara's tile should show her remote stream; it reuses the local camera for demos.
  { id: 'amara', name: 'Amara Osei', role: 'Candidate', video: 'local-demo', avatarColor: 'var(--avatar-2)' },
  { id: 'daniel', name: 'Daniel Cho', role: 'Hiring manager', video: 'avatar', avatarColor: 'var(--avatar-3)' },
  { id: 'priya', name: 'Priya Raman', role: 'Recruiter', video: 'avatar', avatarColor: 'var(--avatar-4)' },
]

export const CANDIDATE_ID = 'amara'

export function participantName(id: string): string {
  return PARTICIPANTS.find((p) => p.id === id)?.name ?? id
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()
}
