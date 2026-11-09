import { Hono } from 'hono'
import { IntrospectRequest, type IntrospectResponse } from '@knock/shared'
import { verifyTrustToken } from '../token.ts'

export const tokens = new Hono()

/** Relying apps' backends call this to check a token the SDK handed them. */
tokens.post('/introspect', async (c) => {
  const parsed = IntrospectRequest.safeParse(await c.req.json())
  if (!parsed.success) return c.json({ error: parsed.error.issues }, 400)

  let body: IntrospectResponse
  try {
    body = { valid: true, claims: await verifyTrustToken(parsed.data.token) }
  } catch (err) {
    body = { valid: false, error: err instanceof Error ? err.message : 'invalid token' }
  }
  return c.json(body)
})
