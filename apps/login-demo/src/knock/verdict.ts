import type { CheckOutcomeResult, OverallVerdict } from './types.ts'

/** How long an all-pass result stays valid. */
export const VERDICT_TTL_MS = 30_000

/**
 * Any fail → not verified (veto). Else any inconclusive/skipped → unable.
 * Else any review → needs review (never a veto on its own). Only all-pass is verified.
 */
export function deriveVerdict(results: CheckOutcomeResult[], now: number): OverallVerdict {
  const failing = results.filter((r) => r.status === 'fail')
  if (failing.length > 0) {
    return {
      status: 'not_verified',
      at: now,
      failing: failing.map((r) => r.kind),
      reason: failing[0].reasons[0] ?? `${failing[0].kind} check failed`,
    }
  }
  const unsure = results.find((r) => r.status === 'inconclusive' || r.status === 'skipped')
  if (unsure || results.length === 0) {
    return {
      status: 'unable',
      at: now,
      cause: 'inconclusive',
      reason: unsure?.reasons[0] ?? 'No checks completed',
    }
  }
  const reviewing = results.filter((r) => r.status === 'review')
  if (reviewing.length > 0) {
    return {
      status: 'needs_review',
      at: now,
      reviewing: reviewing.map((r) => r.kind),
      reason: reviewing[0].reasons[0] ?? `${reviewing[0].kind} needs review`,
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
