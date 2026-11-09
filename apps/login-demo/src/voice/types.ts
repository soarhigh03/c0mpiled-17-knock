export type VoiceLabel = 'review' | 'pass' | 'unable'

/** Private local IPC result. Never include this object in a session payload. */
export interface VoiceWindowResult {
  label: VoiceLabel
  modelScore: number | null
  reason: string | null
  latencyMs: number
}

/** The complete allowlist at the boundary to KnockClient. */
export interface VoiceResult {
  label: VoiceLabel
  at: number
}

export type VoicePublicResult = VoiceResult

export interface VoiceSnapshot {
  state: VoiceLabel
  lastWindowAt: number | null
  backlog: number
  droppedWindows: number
  skipReason: string | null
  reason: string | null
}

/** Bounded, in-memory diagnostics. No audio is retained here. */
export interface LocalVoiceReportEntry extends VoiceWindowResult {
  at: number
  aggregatedLabel: VoiceLabel
}
