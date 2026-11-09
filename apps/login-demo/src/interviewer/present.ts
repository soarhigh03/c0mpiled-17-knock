import type { CheckProgress, CheckRow, OverallVerdict } from '../knock/types.ts'

export type Tone = 'pass' | 'fail' | 'review' | 'muted' | 'accent'

export function formatAgo(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 2) return 'just now'
  if (s < 60) return `${s}s ago`
  return `${Math.floor(s / 60)}m ago`
}

export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function formatClock(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

export function secondsLeft(expiresAt: number, now: number): number {
  return Math.max(0, Math.ceil((expiresAt - now) / 1000))
}

/** Text for the stage badge. */
export function badgeFor(
  verdict: OverallVerdict,
  progress: CheckProgress | null,
  now: number,
): { tone: Tone; text: string } {
  switch (verdict.status) {
    case 'idle':
      return { tone: 'muted', text: 'Not checked yet' }
    case 'checking':
      return { tone: 'accent', text: `Checking… ${Math.round((progress?.fraction ?? 0) * 100)}%` }
    case 'verified':
      return { tone: 'pass', text: `Human verified · ${formatAgo(now - verdict.verifiedAt)}` }
    case 'not_verified':
      return { tone: 'fail', text: 'Not verified' }
    case 'unable':
      if (verdict.cause === 'expired') return { tone: 'review', text: 'Unable to verify — result expired' }
      if (verdict.cause === 'device_changed') return { tone: 'review', text: 'Unable to verify — device changed' }
      return { tone: 'review', text: 'Unable to verify' }
  }
}

/** Short status for tile badges and participant chips. */
export function shortStatus(verdict: OverallVerdict): { tone: Tone; text: string } {
  switch (verdict.status) {
    case 'idle':
      return { tone: 'muted', text: 'Not checked' }
    case 'checking':
      return { tone: 'accent', text: 'Checking' }
    case 'verified':
      return { tone: 'pass', text: 'Verified' }
    case 'not_verified':
      return { tone: 'fail', text: 'Not verified' }
    case 'unable':
      return { tone: 'review', text: 'Unable to verify' }
  }
}

/** Worst result across participants, for the Knock button dot. Null until someone has a result. */
export function aggregateTone(verdicts: OverallVerdict[]): Tone | null {
  if (verdicts.some((v) => v.status === 'not_verified')) return 'fail'
  if (verdicts.some((v) => v.status === 'unable')) return 'review'
  if (verdicts.some((v) => v.status === 'verified')) return 'pass'
  return null
}

/** Pill for a check row. Passes from a result that no longer holds are shown as stale, never green. */
export function rowPill(row: CheckRow, verdict: OverallVerdict): { tone: Tone; text: string } {
  const stale = verdict.status === 'unable' && verdict.cause !== 'inconclusive'
  switch (row.status) {
    case 'waiting':
      return { tone: 'muted', text: 'Waiting' }
    case 'running':
      return { tone: 'accent', text: 'Checking' }
    case 'pass':
      if (stale) return { tone: 'muted', text: verdict.cause === 'expired' ? 'Expired' : 'Outdated' }
      return { tone: 'pass', text: 'Pass' }
    case 'fail':
      return { tone: 'fail', text: 'Fail' }
    case 'inconclusive':
      return { tone: 'review', text: 'Unable' }
    case 'skipped':
      return { tone: 'muted', text: 'Skipped' }
  }
}
