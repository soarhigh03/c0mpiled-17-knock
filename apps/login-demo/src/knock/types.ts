import type { ChallengeKind, CheckStatus } from '@knock/shared'

/**
 * UI-facing Knock state. Check kinds and per-check statuses come from
 * @knock/shared; everything here is what the interviewer screen needs on top.
 */

export type CheckRowStatus = 'waiting' | 'running' | CheckStatus

export interface CheckRow {
  kind: ChallengeKind
  status: CheckRowStatus
  /** One-line summary of the latest result (or what the check looks at). */
  detail: string
  score?: number
  reasons: string[]
  /** When this check finished (ms epoch). */
  at?: number
}

export interface CheckProgress {
  current: ChallengeKind
  /** 1-based index of the running check. */
  step: number
  total: number
  /** 0–1 across the whole run. */
  fraction: number
  /** Color the light challenge is flashing right now. */
  swatch?: string
  /** Light-response signal (0–1), oldest first. */
  signal: number[]
  /** Number of samples a full light challenge produces. */
  signalCapacity: number
}

export type UnableCause = 'inconclusive' | 'expired' | 'device_changed'

export type OverallVerdict =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'verified'; verifiedAt: number; expiresAt: number }
  | { status: 'not_verified'; at: number; failing: ChallengeKind[]; reason: string }
  | { status: 'unable'; at: number; cause: UnableCause; reason: string }

export interface TrustToken {
  jwt: string
  issuedAt: number
  expiresAt: number
}

export interface EnvironmentSnapshot {
  camera: string
  mic: string
  displays: number
  /** Which device changed mid-call, if any. */
  changed?: 'camera' | 'mic' | 'displays'
}

export type ActivityTone = 'pass' | 'fail' | 'review' | 'info'

export interface ActivityEntry {
  id: string
  at: number
  tone: ActivityTone
  message: string
}

/** Transient stage alert, e.g. a device changed mid-call. */
export interface KnockAlert {
  id: string
  at: number
  title: string
  message: string
}

export interface KnockState {
  sessionId: string | null
  verdict: OverallVerdict
  checks: CheckRow[]
  progress: CheckProgress | null
  token: TrustToken | null
  environment: EnvironmentSnapshot
  /** Newest first. */
  activity: ActivityEntry[]
  alert: KnockAlert | null
}

/** The only surface the UI talks to; the mock is swapped for the real SDK later. */
export interface KnockClient {
  subscribe(listener: (state: KnockState) => void): () => void
  requestCheck(): void
  getState(): KnockState
}
