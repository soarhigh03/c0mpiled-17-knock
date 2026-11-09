import type { Challenge, CheckResult } from '@knock/shared'

export interface Session {
  id: string
  createdAt: number
  expiresAt: number
  challenges: Challenge[]
  results: Map<Challenge['kind'], CheckResult>
}

// In-memory for the hackathon. Swap for Redis/SQLite if needed.
const store = new Map<string, Session>()

export function saveSession(session: Session) {
  store.set(session.id, session)
}

export function getSession(id: string): Session | undefined {
  const s = store.get(id)
  if (s && s.expiresAt < Date.now()) {
    store.delete(id)
    return undefined
  }
  return s
}
