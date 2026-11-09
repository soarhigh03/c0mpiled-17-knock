import type { KnockClient, KnockState } from '../knock/types.ts'
import type { RoomLink } from './link.ts'
import type { EnvironmentEvent, PublishedCheck, RoomMessage } from './messages.ts'

/**
 * Candidate side of the room channel: publishes presence, check results and
 * environment events from this window's KnockClient, and runs checks the
 * interviewer requests.
 *
 * The link is owned by the caller — the same one carries the call's media —
 * so this closes its subscriptions and leaves the transport alone.
 */
export function connectRoomPublisher(link: RoomLink, participantId: string, client: KnockClient): () => void {
  const post = (message: RoomMessage) => link.post(message)
  const events: EnvironmentEvent[] = []
  let lastResult: Extract<RoomMessage, { type: 'result' }> | null = null
  let requestedAt: number | null = null
  let startedAt = Date.now()
  let prev: KnockState = client.getState()

  const presence = () => post({ type: 'presence', participantId, environment: client.getState().environment, at: Date.now() })

  const emitEvent = (event: EnvironmentEvent) => {
    events.push(event)
    post({ type: 'environment-event', participantId, event, environment: client.getState().environment })
  }

  const offClient = client.subscribe((next) => {
    const before = prev
    prev = next
    if (next.environment !== before.environment && !next.environment.changed) presence()

    if (next.verdict.status === 'checking' && before.verdict.status !== 'checking') {
      startedAt = Date.now()
      post({ type: 'checking', participantId, startedAt })
    }
    if (next.alert && next.alert.id !== before.alert?.id && next.verdict.status === 'unable' && next.verdict.cause === 'device_changed') {
      emitEvent({ at: next.alert.at, kind: 'device_changed', tone: 'review', message: next.alert.message, change: deviceChange(next) })
    }
    const finished =
      before.verdict.status === 'checking' && next.verdict.status !== 'checking' && next.verdict.status !== 'idle'
    if (finished) {
      const perCheck: PublishedCheck[] = next.checks.map((row) => ({
        kind: row.kind,
        status: row.status === 'waiting' || row.status === 'running' ? 'skipped' : row.status,
        score: row.score ?? null,
        reasons: row.reasons,
        detail: row.detail,
        at: row.at ?? null,
      }))
      lastResult = {
        type: 'result',
        participantId,
        perCheck,
        verdict: next.verdict,
        token: next.token?.jwt ?? null,
        timestamps: { requestedAt, startedAt, finishedAt: Date.now() },
        environment: next.environment,
        environmentEvents: [...events],
      }
      requestedAt = null
      post(lastResult)
    }
  })

  link.onMessage((msg) => {
    if (msg.type === 'hello') {
      presence()
      if (lastResult) post(lastResult)
    } else if (msg.type === 'request-check') {
      requestedAt = msg.at
      client.requestCheck()
    }
  })

  // Native signals the interviewer should know about (Electron only).
  let lastApps = new Set<string>()
  let lastDisplays: number | null = null
  const offNative = window.knockNative?.onEnvironmentChanged((env, reason) => {
    const at = Date.now()
    if (reason === 'processes') {
      const apps = new Set(env.suspiciousProcesses.map((p) => p.app))
      for (const app of apps) if (!lastApps.has(app)) emitEvent({ at, kind: 'processes', tone: 'review', message: `${app} started` })
      for (const app of lastApps) if (!apps.has(app)) emitEvent({ at, kind: 'processes', tone: 'info', message: `${app} quit` })
      lastApps = apps
    } else if (reason === 'displays') {
      if (lastDisplays !== null && env.displays.length !== lastDisplays) {
        emitEvent({ at, kind: 'displays', tone: 'review', message: `Displays changed: ${lastDisplays} → ${env.displays.length}` })
      }
      lastDisplays = env.displays.length
    } else if (reason === 'focus' && env.windowFocused && env.focus.lastBlurMs !== null) {
      emitEvent({ at, kind: 'focus', tone: 'review', message: `Left the preSense window for ${(env.focus.lastBlurMs / 1000).toFixed(1)} s` })
    }
  })
  void window.knockNative?.getEnvironment().then((env) => {
    lastApps = new Set(env.suspiciousProcesses.map((p) => p.app))
    lastDisplays = env.displays.length
  })

  presence()
  return () => {
    offClient()
    offNative?.()
  }
}

function deviceChange(state: KnockState) {
  const key = state.environment.changed
  if (!key || key === 'displays') return undefined
  return {
    device: key === 'camera' ? ('camera' as const) : ('microphone' as const),
    from: '',
    to: key === 'camera' ? state.environment.camera : state.environment.mic,
    reason: 'Device changed mid-call',
  }
}
