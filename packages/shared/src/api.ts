import { z } from 'zod'
import { Challenge, ChallengeKind } from './challenge.ts'
import { Evidence } from './evidence.ts'
import { Verdict, TrustTokenClaims, CheckResult } from './verdict.ts'

/** POST /v1/sessions */
export const CreateSessionRequest = z.object({
  checks: z.array(ChallengeKind).min(1),
})
export type CreateSessionRequest = z.infer<typeof CreateSessionRequest>

export const CreateSessionResponse = z.object({
  sessionId: z.string(),
  expiresAt: z.number(),
  challenges: z.array(Challenge),
})
export type CreateSessionResponse = z.infer<typeof CreateSessionResponse>

/** POST /v1/sessions/:id/evidence */
export const SubmitEvidenceRequest = z.object({ evidence: Evidence })
export type SubmitEvidenceRequest = z.infer<typeof SubmitEvidenceRequest>

export const SubmitEvidenceResponse = z.object({ result: CheckResult })
export type SubmitEvidenceResponse = z.infer<typeof SubmitEvidenceResponse>

/** POST /v1/sessions/:id/verify */
export const VerifyResponse = z.object({
  verdict: Verdict,
  token: z.string(),
})
export type VerifyResponse = z.infer<typeof VerifyResponse>

/** POST /v1/tokens/introspect — for relying apps' backends */
export const IntrospectRequest = z.object({ token: z.string() })
export const IntrospectResponse = z.discriminatedUnion('valid', [
  z.object({ valid: z.literal(true), claims: TrustTokenClaims }),
  z.object({ valid: z.literal(false), error: z.string() }),
])
export type IntrospectResponse = z.infer<typeof IntrospectResponse>
