import type { ChallengeKind, CheckStatus, EnvironmentEvidence } from '@knock/shared'

/**
 * UI-facing Knock state. Check kinds and per-check statuses come from
 * @knock/shared; everything here is what the interviewer screen needs on top.
 */

/**
 * @knock/shared CheckStatus plus 'review': a signal worth a human look that must
 * not veto on its own (e.g. suspected synthetic voice while false positives are
 * unmeasured). TODO(shared): the shared schema has no 'review' status yet.
 */
export type CheckOutcome = CheckStatus | 'review'

export interface CheckOutcomeResult {
  kind: ChallengeKind
  status: CheckOutcome
  /** Model score; only ever shown in the report modal. */
  score: number
  reasons: string[]
}

export type CheckRowStatus = 'waiting' | 'running' | CheckOutcome

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
  | { status: 'needs_review'; at: number; reviewing: ChallengeKind[]; reason: string }
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
  /** Challenge the participant's screen should run now, if any. */
  challenge: ChallengeRequest | null
  /** What the last challenge reported back (steps and audio metadata). */
  lastCapture: ChallengeCapture | null
}

/** A challenge to run on the participant's own screen. */
export interface ChallengeRequest {
  id: string
  /** Saturated colors flashed full-window, in order. Upcoming ones are never shown. */
  colors: string[]
  stepMs: number
  /** 10–14 words: the voice model needs at least ~4 s of speech. */
  phrase: string
  sonar: boolean
  requestedBy: string
}

export interface StepMark {
  index: number
  color: string
  /** performance.now() of the first frame showing this color. */
  at: number
}

export interface ChallengeAudioMeta {
  /** performance.now() clock, same as StepMark.at. */
  startedAt: number
  endedAt: number
  sampleRate: number
}

export interface ChallengeCapture {
  challengeId: string
  steps: StepMark[]
  audio: (ChallengeAudioMeta & { bytes: number; type: string }) | null
  completedAt: number | null
}

export interface DeviceChange {
  device: 'camera' | 'microphone'
  from: string
  to: string
  reason: string
}

/** What the participant's device reports about its environment. */
export interface EnvironmentReport {
  /** In the @knock/shared EnvironmentEvidence shape, for the server. */
  evidence: EnvironmentEvidence
  activeCamera: string | null
  activeMicrophone: string | null
  /** Set when the live stream moved to a different device mid-call. */
  change?: DeviceChange
}

/** The only surface the UI talks to; the mock is swapped for the real SDK later. */
export interface KnockClient {
  subscribe(listener: (state: KnockState) => void): () => void
  requestCheck(): void
  getState(): KnockState
  reportEnvironment(report: EnvironmentReport): void
  /** Called once per color step so light analysis can align the schedule with video frames. */
  onStep(index: number, color: string, at: number): void
  /** Microphone audio for the whole reading window, for the voice check. */
  onChallengeAudio(audio: Blob, meta: ChallengeAudioMeta): void
  /** The challenge screen finished (or was abandoned) and closed. */
  endChallenge(id: string): void
}
