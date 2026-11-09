import type { ChallengeKind } from '@knock/shared'
import { CHECK_HINT } from './checks.ts'
import type { ActivityTone, CheckRow, KnockState } from './types.ts'

let entrySeq = 0
export const nextEntryId = () => `e${++entrySeq}`

export function emptyState(checks: readonly ChallengeKind[], firstActivity: string): KnockState {
  return {
    sessionId: null,
    verdict: { status: 'idle' },
    checks: checks.map((kind): CheckRow => ({ kind, status: 'waiting', detail: CHECK_HINT[kind], reasons: [] })),
    progress: null,
    token: null,
    environment: { camera: '—', mic: '—', displays: 0 },
    activity: [{ id: nextEntryId(), at: Date.now(), tone: 'info', message: firstActivity }],
    alert: null,
    challenge: null,
    lastCapture: null,
    introspection: null,
  }
}

/** Observable state shared by the real clients (subscribe / getState plumbing). */
export class ClientStore {
  protected state: KnockState
  private readonly listeners = new Set<(state: KnockState) => void>()
  protected readonly timers = new Set<ReturnType<typeof setTimeout>>()

  constructor(initial: KnockState) {
    this.state = initial
  }

  subscribe(listener: (state: KnockState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState(): KnockState {
    return this.state
  }

  protected update(patch: Partial<KnockState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener(this.state)
  }

  protected setRow(kind: ChallengeKind, patch: Partial<CheckRow>): void {
    this.update({ checks: this.state.checks.map((row) => (row.kind === kind ? { ...row, ...patch } : row)) })
  }

  protected log(tone: ActivityTone, message: string, at = Date.now()): void {
    this.update({ activity: [{ id: nextEntryId(), at, tone, message }, ...this.state.activity].slice(0, 50) })
  }

  protected after(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t)
      fn()
    }, ms)
    this.timers.add(t)
  }

  protected clearTimers(): void {
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
  }
}

/** exp claim of a JWT in ms, without verifying it (verification is the server's job). */
export function jwtExpiry(jwt: string): number | null {
  try {
    const payload = JSON.parse(atob(jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp?: number }
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null
  } catch {
    return null
  }
}
