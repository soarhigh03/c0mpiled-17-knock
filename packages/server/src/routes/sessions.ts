import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import {
  CreateSessionRequest,
  SubmitEvidenceRequest,
  type CheckResult,
  type CreateSessionResponse,
  type SubmitEvidenceResponse,
  type VerifyResponse,
} from '@knock/shared'
import { config } from '../config.ts'
import { issueChallenge } from '../challenges.ts'
import { getSession, saveSession } from '../store.ts'
import { runVerifier } from '../verifiers/index.ts'
import { aggregate } from '../verifiers/aggregate.ts'
import { signTrustToken } from '../token.ts'

export const sessions = new Hono()

sessions.post('/', async (c) => {
  const parsed = CreateSessionRequest.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400)

  const now = Date.now()
  const session = {
    id: randomUUID(),
    createdAt: now,
    expiresAt: now + config.sessionTtlMs,
    challenges: parsed.data.checks.map(issueChallenge),
    results: new Map(),
  }
  saveSession(session)

  const body: CreateSessionResponse = {
    sessionId: session.id,
    expiresAt: session.expiresAt,
    challenges: session.challenges,
  }
  return c.json(body, 201)
})

sessions.post('/:id/evidence', async (c) => {
  const session = getSession(c.req.param('id'))
  if (!session) return c.json({ error: 'session not found or expired' }, 404)

  const parsed = SubmitEvidenceRequest.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400)

  const { evidence } = parsed.data
  const challenge = session.challenges.find((ch) => ch.kind === evidence.kind)
  if (!challenge) return c.json({ error: `no ${evidence.kind} challenge in session` }, 400)

  const result = await runVerifier(challenge, evidence)
  session.results.set(evidence.kind, result)

  const body: SubmitEvidenceResponse = { result }
  return c.json(body)
})

sessions.post('/:id/verify', async (c) => {
  const session = getSession(c.req.param('id'))
  if (!session) return c.json({ error: 'session not found or expired' }, 404)

  const checks: CheckResult[] = session.challenges.map(
    (ch) =>
      session.results.get(ch.kind) ?? {
        kind: ch.kind,
        status: 'skipped',
        score: 0,
        reasons: ['no evidence submitted'],
      },
  )
  const verdict = aggregate(session.id, checks)
  const token = await signTrustToken({
    sub: session.id,
    human: verdict.human,
    score: verdict.score,
    checks: Object.fromEntries(checks.map((r) => [r.kind, r.status])),
  })

  const body: VerifyResponse = { verdict, token }
  return c.json(body)
})
