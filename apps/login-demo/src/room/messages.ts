import type { ChallengeKind } from '@knock/shared'
import type { CheckOutcome, DeviceChange, EnvironmentSnapshot, OverallVerdict } from '../knock/types.ts'

/**
 * Messages between the interviewer and candidate windows of one room.
 * BroadcastChannel only reaches same-origin windows on this machine; it stands
 * in for the call's signalling channel until there is one.
 */
export const roomChannelName = (code: string) => `knock-room-${code}`

export interface PublishedCheck {
  kind: ChallengeKind
  status: CheckOutcome
  score: number | null
  reasons: string[]
  detail: string
  at: number | null
}

export interface EnvironmentEvent {
  at: number
  kind: 'device_changed' | 'processes' | 'displays' | 'focus'
  tone: 'info' | 'review'
  message: string
  change?: DeviceChange
}

export type RoomMessage =
  /** Interviewer joined or reloaded: candidate re-sends presence and its last result. */
  | { type: 'hello' }
  | { type: 'request-check'; requestedBy: string; at: number }
  | { type: 'presence'; participantId: string; environment: EnvironmentSnapshot; at: number }
  | { type: 'checking'; participantId: string; startedAt: number }
  | {
      type: 'result'
      participantId: string
      perCheck: PublishedCheck[]
      verdict: OverallVerdict
      token: string | null
      timestamps: { requestedAt: number | null; startedAt: number; finishedAt: number }
      environment: EnvironmentSnapshot
      environmentEvents: EnvironmentEvent[]
    }
  | { type: 'environment-event'; participantId: string; event: EnvironmentEvent; environment: EnvironmentSnapshot }
