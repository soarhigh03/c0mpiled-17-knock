import { z } from 'zod'
import { ChallengeKind } from './challenge.ts'

export const CheckStatus = z.enum(['pass', 'fail', 'inconclusive', 'skipped'])
export type CheckStatus = z.infer<typeof CheckStatus>

export const CheckResult = z.object({
  kind: ChallengeKind,
  status: CheckStatus,
  /** 0 (surely fake) – 1 (surely human). */
  score: z.number().min(0).max(1),
  reasons: z.array(z.string()),
})
export type CheckResult = z.infer<typeof CheckResult>

export const Verdict = z.object({
  sessionId: z.string(),
  human: z.boolean(),
  score: z.number().min(0).max(1),
  checks: z.array(CheckResult),
})
export type Verdict = z.infer<typeof Verdict>

/** Claims inside the signed trust token that relying apps verify. */
export const TrustTokenClaims = z.object({
  sub: z.string(),
  human: z.boolean(),
  score: z.number(),
  checks: z.partialRecord(ChallengeKind, CheckStatus),
})
export type TrustTokenClaims = z.infer<typeof TrustTokenClaims>
