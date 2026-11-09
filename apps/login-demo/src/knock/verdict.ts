import type { CheckResult } from '@knock/shared'
import type { OverallVerdict } from './types.ts'

/** How long an all-pass result stays valid. */
export const VERDICT_TTL_MS = 30_000

/**
 * Any fail → not verified (veto). Otherwise anything short of a pass
 * (inconclusive / skipped) → unable. Only all-pass is verified.
 */
export function deriveVerdict(results: CheckResult[], now: number): OverallVerdict {
  const failing = results.filter((r) => r.status === 'fail')
  if (failing.length > 0) {
    return {
      status: 'not_verified',
      at: now,
      failing: failing.map((r) => r.kind),
      reason: failing[0].reasons[0] ?? `${failing[0].kind} check failed`,
    }
  }
  const unsure = results.find((r) => r.status !== 'pass')
  if (unsure || results.length === 0) {
    return {
      status: 'unable',
      at: now,
      cause: 'inconclusive',
      reason: unsure?.reasons[0] ?? 'No checks completed',
    }
  }
  return { status: 'verified', verifiedAt: now, expiresAt: now + VERDICT_TTL_MS }
}

/** A pass is only good until expiresAt; after that it must never read as verified. */
export function effectiveVerdict(verdict: OverallVerdict, now: number): OverallVerdict {
  if (verdict.status === 'verified' && now >= verdict.expiresAt) {
    return { status: 'unable', at: verdict.expiresAt, cause: 'expired', reason: 'Result expired' }
  }
  return verdict
}
