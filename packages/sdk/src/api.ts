import type {
  ChallengeKind,
  CreateSessionResponse,
  Evidence,
  SubmitEvidenceResponse,
  VerifyResponse,
} from '@knock/shared'

export class KnockApi {
  private readonly baseUrl: string

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl
  }

  private async post<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`knock api ${path} failed: ${res.status} ${await res.text()}`)
    return res.json() as Promise<T>
  }

  createSession(checks: ChallengeKind[]) {
    return this.post<CreateSessionResponse>('/v1/sessions', { checks })
  }

  submitEvidence(sessionId: string, evidence: Evidence) {
    return this.post<SubmitEvidenceResponse>(`/v1/sessions/${sessionId}/evidence`, { evidence })
  }

  verify(sessionId: string) {
    return this.post<VerifyResponse>(`/v1/sessions/${sessionId}/verify`)
  }
}
