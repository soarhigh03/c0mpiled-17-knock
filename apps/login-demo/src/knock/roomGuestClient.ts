import type { IntrospectResponse } from '@knock/shared'
import type { Room } from '../rooms.ts'
import { roomChannelName, type PublishedCheck, type RoomMessage } from '../room/messages.ts'
import { CHECK_LABEL } from './checks.ts'
import { ClientStore, emptyState, jwtExpiry } from './store.ts'
import type { CheckOutcomeResult, Introspection, KnockClient, OverallVerdict } from './types.ts'
import { deriveVerdict } from './verdict.ts'

interface RoomGuestClientOptions {
  room: Room
  participantId: string
  apiUrl: string
  /** Shown to the guest as who asked for the check. */
  requestedBy: string
}

/**
 * Interviewer-side view of the room's guest. Results arrive from the guest's
 * window over the room channel; a "Verified" verdict is only shown after the
 * server confirms the guest's trust token via /v1/tokens/introspect.
 */
export class RoomGuestClient extends ClientStore implements KnockClient {
  private readonly channel: BroadcastChannel
  private readonly options: RoomGuestClientOptions
  private joined = false

  constructor(options: RoomGuestClientOptions) {
    super(emptyState(options.room.checks, `Waiting for ${options.room.guest.name} to join`))
    this.options = options
    this.channel = new BroadcastChannel(roomChannelName(options.room.code))
    this.channel.onmessage = (e: MessageEvent<RoomMessage>) => void this.handle(e.data)
    this.post({ type: 'hello' })
  }

  dispose(): void {
    this.clearTimers()
    this.channel.close()
  }

  requestCheck(): void {
    if (this.state.verdict.status === 'checking') return
    if (!this.joined) {
      this.log('review', `${this.options.room.guest.name} hasn't joined yet`)
      return
    }
    this.post({ type: 'request-check', requestedBy: this.options.requestedBy, at: Date.now() })
    this.log('info', 'Check requested')
  }

  private post(message: RoomMessage): void {
    this.channel.postMessage(message)
  }

  private async handle(msg: RoomMessage): Promise<void> {
    if ('participantId' in msg && msg.participantId !== this.options.participantId) return
    switch (msg.type) {
      case 'presence':
        if (!this.joined) this.log('info', `${this.options.room.guest.name} joined`, msg.at)
        this.joined = true
        this.update({ environment: msg.environment })
        return
      case 'checking':
        this.joined = true
        this.clearTimers()
        this.update({ verdict: { status: 'checking' }, progress: null, token: null, introspection: null })
        this.log('info', 'Check running on their device', msg.startedAt)
        return
      case 'environment-event':
        this.update({ environment: msg.environment })
        this.log(msg.event.tone, msg.event.message, msg.event.at)
        if (msg.event.change) {
          this.clearTimers()
          this.update({
            verdict: { status: 'unable', at: msg.event.at, cause: 'device_changed', reason: 'Device changed mid-call' },
            token: null,
            alert: { id: `alert-${msg.event.at}`, at: msg.event.at, title: 'Device changed mid-call', message: msg.event.message },
          })
        }
        return
      case 'result':
        this.joined = true
        return this.receiveResult(msg)
      default:
        return
    }
  }

  private async receiveResult(msg: Extract<RoomMessage, { type: 'result' }>): Promise<void> {
    const receivedAt = Date.now()
    this.clearTimers()
    this.update({
      environment: msg.environment,
      checks: this.state.checks.map((row) => {
        const c = msg.perCheck.find((p) => p.kind === row.kind)
        return c ? { ...row, status: c.status, detail: c.detail, reasons: c.reasons, score: c.score ?? undefined, at: c.at ?? undefined } : row
      }),
    })
    for (const c of msg.perCheck) {
      if (c.status !== 'not_run') this.log(toneOf(c), `${CHECK_LABEL[c.kind]}: ${c.detail}`, c.at ?? receivedAt)
    }

    const introspection = msg.token ? await this.introspect(msg.token) : null
    const verdict = this.decide(msg.perCheck, introspection, receivedAt)
    this.update({
      verdict,
      introspection,
      token:
        msg.token && introspection?.valid
          ? { jwt: msg.token, issuedAt: receivedAt, expiresAt: jwtExpiry(msg.token) ?? receivedAt }
          : null,
    })
    if (introspection) {
      this.log(introspection.valid ? 'info' : 'fail', introspection.valid ? 'Trust token confirmed by the server' : `Trust token rejected: ${introspection.error}`)
    }
    if (verdict.status === 'verified') {
      this.after(verdict.expiresAt - Date.now(), () => {
        if (this.state.verdict.status !== 'verified') return
        this.update({ verdict: { status: 'unable', at: Date.now(), cause: 'expired', reason: 'Result expired' }, token: null })
        this.log('review', 'Result expired — run a new check')
      })
    }
  }

  /**
   * Per-check results decide the verdict; "Verified" additionally needs a token the
   * server accepts, saying human, with claims matching the reported checks.
   */
  private decide(perCheck: PublishedCheck[], introspection: Introspection | null, now: number): OverallVerdict {
    const outcomes: CheckOutcomeResult[] = perCheck.map((c) => ({ kind: c.kind, status: c.status, score: c.score ?? 0, reasons: c.reasons }))
    const local = deriveVerdict(outcomes, now)
    if (local.status !== 'verified') return local

    if (!introspection) return { status: 'unable', at: now, cause: 'inconclusive', reason: 'No trust token received' }
    if (!introspection.valid || !introspection.claims) {
      return { status: 'not_verified', at: now, failing: [], reason: `Trust token rejected by the server (${introspection.error ?? 'invalid'})` }
    }
    const claims = introspection.claims
    const mismatch = perCheck.find((c) => c.status !== 'not_run' && claims.checks[c.kind] !== c.status)
    if (mismatch) {
      return { status: 'not_verified', at: now, failing: [mismatch.kind], reason: "Token claims don't match the reported checks" }
    }
    if (!claims.human) return { status: 'unable', at: now, cause: 'inconclusive', reason: 'Server did not mark this session as a live person' }
    // The server's claim schema strips exp, so read it from the (now verified) token.
    const tokenExpiry = introspection.expiresAt ?? local.expiresAt
    return { ...local, expiresAt: Math.min(local.expiresAt, tokenExpiry) }
  }

  private async introspect(token: string): Promise<Introspection> {
    const checkedAt = Date.now()
    try {
      const res = await fetch(`${this.options.apiUrl}/v1/tokens/introspect`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (!res.ok) return { checkedAt, valid: false, error: `HTTP ${res.status}` }
      const body = (await res.json()) as IntrospectResponse
      return body.valid
        ? { checkedAt, valid: true, claims: body.claims, expiresAt: jwtExpiry(token) ?? undefined }
        : { checkedAt, valid: false, error: body.error }
    } catch (err) {
      return { checkedAt, valid: false, error: `server unreachable (${err instanceof Error ? err.message : String(err)})` }
    }
  }

  reportEnvironment(): void {}
  attachMedia(): void {}
  attachPanelHost(): void {}
  onStep(): void {}
  onChallengeAudio(): void {}
  endChallenge(): void {}
}

function toneOf(c: PublishedCheck) {
  if (c.status === 'pass') return 'pass' as const
  if (c.status === 'fail') return 'fail' as const
  return 'review' as const
}
