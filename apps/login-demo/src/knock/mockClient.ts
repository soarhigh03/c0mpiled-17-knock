import type { ChallengeKind, CheckStatus, TrustTokenClaims } from '@knock/shared'
import { CHECK_HINT, CHECK_LABEL, CHECK_ORDER, CHECK_RUNNING } from './checks.ts'
import type {
  ActivityTone,
  ChallengeAudioMeta,
  ChallengeRequest,
  CheckOutcome,
  CheckOutcomeResult,
  CheckRow,
  DeviceChange,
  EnvironmentReport,
  EnvironmentSnapshot,
  KnockClient,
  KnockState,
  TrustToken,
} from './types.ts'
import { deriveVerdict } from './verdict.ts'

/**
 * In-memory stand-in for the real SDK client. It fakes the challenge timeline
 * and results locally; nothing here is a real judgement.
 */

type MockResult = Pick<CheckOutcomeResult, 'status' | 'score' | 'reasons'> & { detail: string }
type Plan = Record<ChallengeKind, MockResult>

export type Scenario =
  | 'idle'
  | 'checking'
  | 'verified'
  | 'voice_review'
  | 'light_fail'
  | 'unable'
  | 'device_changed'
  | 'challenge'

const STEP_MS: Record<ChallengeKind, number> = {
  environment: 900,
  light: 3600,
  sonar: 1800,
  voice: 2200,
}
const RUN_MS = CHECK_ORDER.reduce((sum, kind) => sum + STEP_MS[kind], 0)
const TICK_MS = 100
const LIGHT_FRAMES = 6
const LIGHT_FRAME_MS = STEP_MS.light / LIGHT_FRAMES
const SIGNAL_CAPACITY = STEP_MS.light / TICK_MS

const DEFAULT_ENV: EnvironmentSnapshot = {
  camera: 'FaceTime HD Camera',
  mic: 'MacBook Pro Microphone',
  displays: 1,
}
const VIRTUAL_CAMERA = 'OBS Virtual Camera'

const CHALLENGE_COLORS = ['#FF453A', '#30D158', '#0A84FF', '#FFD60A', '#BF5AF2', '#64D2FF', '#FF9F0A', '#FFFFFF']

const PASS: Plan = {
  environment: { status: 'pass', score: 0.97, reasons: [], detail: '1 camera · 1 mic · 1 display · no virtual devices' },
  light: { status: 'pass', score: 0.91, reasons: [], detail: `Face reflected ${LIGHT_FRAMES} of ${LIGHT_FRAMES} screen flashes` },
  sonar: { status: 'pass', score: 0.88, reasons: [], detail: 'Doppler echo matched lip movement' },
  voice: { status: 'pass', score: 0.93, reasons: [], detail: 'No clear synthetic signal' },
}

// Voice policy: a suspected synthetic voice is "review", never a veto on its own.
// The model score stays out of the main UI (report modal only).
const VOICE_REVIEW: Plan = {
  ...PASS,
  voice: {
    status: 'review',
    score: 0.12,
    reasons: ['Synthetic speech suspected'],
    detail: 'Synthetic speech suspected — review',
  },
}

/** Keeps the red path testable now that voice no longer fails. */
const LIGHT_FAIL: Plan = {
  ...PASS,
  light: {
    status: 'fail',
    score: 0.08,
    reasons: ["Face reflection didn't follow the screen colors"],
    detail: "Face reflection didn't follow the screen colors",
  },
}

const LIGHT_UNABLE: Plan = {
  ...PASS,
  light: {
    status: 'inconclusive',
    score: 0.4,
    reasons: ['Camera covered or face not visible'],
    detail: 'Camera covered or face not visible',
  },
}

function virtualCameraPlan(camera: string): Plan {
  const reason = `Virtual camera detected: ${camera}`
  return { ...PASS, environment: { status: 'fail', score: 0.05, reasons: [reason], detail: reason } }
}

let idCounter = 0
const nextId = () => `k${++idCounter}`

/** Saturated, mutually distinct colors; the server picks the real sequence. */
export const CHALLENGE_PALETTE = ['#FF1A1A', '#00E05A', '#1A4DFF', '#FFE600', '#FF1AD9', '#00E5FF', '#FF7A00', '#8A1AFF']

/** 10–14 words each (about 4–6 s read aloud); the voice model needs at least ~4 s of speech. */
export const CHALLENGE_PHRASES = [
  'The river glass is seven steps from the old stone bridge.',
  'Morning trains carry yellow paper boxes past the quiet northern harbor.',
  'A small green kite drifted over the market just before noon.',
  'Please place the silver key beside the third window on the left.',
  'Four tall candles lit the narrow hallway near the garden door.',
  'Our neighbor painted the wooden fence blue during the long summer weekend.',
]

export const CHALLENGE_STEPS = 8
export const CHALLENGE_STEP_MS = 850

/** Random colors with no color repeated back to back. */
export function createMockChallenge(requestedBy: string, random: () => number = Math.random): ChallengeRequest {
  const colors: string[] = []
  while (colors.length < CHALLENGE_STEPS) {
    const next = CHALLENGE_PALETTE[Math.floor(random() * CHALLENGE_PALETTE.length)]
    if (next !== colors[colors.length - 1]) colors.push(next)
  }
  return {
    id: `chl_${nextId()}`,
    colors,
    stepMs: CHALLENGE_STEP_MS,
    phrase: CHALLENGE_PHRASES[Math.floor(random() * CHALLENGE_PHRASES.length)],
    sonar: true,
    requestedBy,
  }
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n))
}

function base64url(input: string | Uint8Array): string {
  const binary = typeof input === 'string' ? input : String.fromCharCode(...input)
  return btoa(binary).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function mockJwt(sessionId: string, results: CheckOutcomeResult[], issuedAt: number, expiresAt: number): string {
  const claims: TrustTokenClaims & { iat: number; exp: number } = {
    sub: sessionId,
    human: true,
    score: Number((results.reduce((s, r) => s + r.score, 0) / results.length).toFixed(2)),
    // Only issued when every check passed, so 'review' never reaches the shared claim type.
    checks: Object.fromEntries(results.map((r) => [r.kind, r.status as CheckStatus])),
    iat: Math.floor(issuedAt / 1000),
    exp: Math.floor(expiresAt / 1000),
  }
  const header = { alg: 'HS256', typ: 'JWT', kid: 'mock' }
  return [base64url(JSON.stringify(header)), base64url(JSON.stringify(claims)), base64url(randomBytes(32))].join('.')
}

function pickColors(n: number): string[] {
  const pool = [...CHALLENGE_COLORS]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, n)
}

/** Expected skin-reflection brightness for a flashed color, 0–1. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  return 0.15 + (0.2126 * r + 0.7152 * g + 0.0722 * b) * 0.8
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

function idleRows(): CheckRow[] {
  return CHECK_ORDER.map((kind) => ({ kind, status: 'waiting', detail: CHECK_HINT[kind], reasons: [] }))
}

function initialState(): KnockState {
  return {
    sessionId: null,
    verdict: { status: 'idle' },
    checks: idleRows(),
    progress: null,
    token: null,
    environment: { ...DEFAULT_ENV },
    activity: [{ id: nextId(), at: Date.now(), tone: 'info', message: 'Monitoring started — no check yet' }],
    alert: null,
    challenge: null,
    lastCapture: null,
    introspection: null,
  }
}

function toneFor(status: CheckOutcome): ActivityTone {
  if (status === 'pass') return 'pass'
  if (status === 'fail') return 'fail'
  return 'review'
}

function checkMessage(kind: ChallengeKind, result: MockResult): string {
  const label = CHECK_LABEL[kind]
  switch (result.status) {
    case 'pass':
      return `${label} passed`
    case 'fail':
      return `${label} failed — ${result.detail}`
    case 'review':
      return `${label} needs review — ${result.detail}`
    case 'inconclusive':
      return `${label} inconclusive — ${result.detail}`
    case 'skipped':
      return `${label} skipped`
    case 'not_run':
      return `${label} not run`
  }
}

export class MockKnockClient implements KnockClient {
  private state: KnockState = initialState()
  private readonly listeners = new Set<(state: KnockState) => void>()
  private readonly timers = new Set<ReturnType<typeof setTimeout>>()
  private ticker: ReturnType<typeof setInterval> | null = null

  subscribe(listener: (state: KnockState) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getState(): KnockState {
    return this.state
  }

  requestCheck(): void {
    if (this.state.verdict.status === 'checking') return
    const { camera } = this.state.environment
    this.startRun(/virtual|obs/i.test(camera) ? virtualCameraPlan(camera) : PASS)
  }

  reportEnvironment(report: EnvironmentReport): void {
    if (report.change) {
      this.changeDevice(report.change)
      return
    }
    const env = this.state.environment
    const next: EnvironmentSnapshot = {
      ...env,
      camera: report.activeCamera ?? env.camera,
      mic: report.activeMicrophone ?? env.mic,
      displays: report.evidence.screenCount ?? env.displays,
    }
    if (next.camera !== env.camera || next.mic !== env.mic || next.displays !== env.displays) {
      this.update({ environment: next })
    }
  }

  attachMedia(): void {
    // The mock fakes every signal; it never reads media.
  }

  onStep(index: number, color: string, at: number): void {
    const capture = this.state.lastCapture
    const challenge = this.state.challenge
    if (!challenge || !capture || capture.challengeId !== challenge.id) return
    // The screen may report a step twice (e.g. React StrictMode in dev); keep the first frame time.
    if (capture.steps.some((s) => s.index === index)) return
    this.update({ lastCapture: { ...capture, steps: [...capture.steps, { index, color, at }] } })
  }

  onChallengeAudio(audio: Blob, meta: ChallengeAudioMeta): void {
    const capture = this.state.lastCapture
    if (!capture) return
    // TODO(sdk): upload for the voice check; the mock only keeps the metadata.
    this.update({ lastCapture: { ...capture, audio: { ...meta, bytes: audio.size, type: audio.type } } })
  }

  endChallenge(id: string): void {
    if (this.state.challenge?.id !== id) return
    const capture = this.state.lastCapture
    this.update({
      challenge: null,
      lastCapture: capture && { ...capture, completedAt: Date.now() },
    })
    this.log('info', `Challenge finished — ${capture?.steps.length ?? 0} color steps recorded`)
  }

  /** Mock stand-in for the interviewer requesting a check on this participant. */
  issueChallenge(requestedBy: string): void {
    const challenge = createMockChallenge(requestedBy)
    this.update({
      challenge,
      lastCapture: { challengeId: challenge.id, steps: [], audio: null, completedAt: null },
    })
    this.log('info', `Challenge requested by ${requestedBy}`)
  }

  scheduleChallenge(delayMs: number, requestedBy: string): void {
    this.after(delayMs, () => this.issueChallenge(requestedBy))
  }

  /** Dev only: jump to a canned scenario. */
  runScenario(scenario: Scenario): void {
    this.reset()
    switch (scenario) {
      case 'idle':
        return
      case 'checking':
        return this.startRun(PASS)
      case 'verified':
        return this.completeInstantly(PASS)
      case 'voice_review':
        return this.completeInstantly(VOICE_REVIEW)
      case 'light_fail':
        return this.completeInstantly(LIGHT_FAIL)
      case 'challenge':
        return this.issueChallenge('Jordan Lee')
      case 'unable':
        return this.completeInstantly(LIGHT_UNABLE)
      case 'device_changed':
        this.completeInstantly(PASS)
        this.after(1500, () =>
          this.changeDevice({
            device: 'camera',
            from: this.state.environment.camera,
            to: VIRTUAL_CAMERA,
            reason: 'Track moved to another device',
          }),
        )
        return
    }
  }

  private startRun(plan: Plan): void {
    this.stop()
    const startedAt = Date.now()
    const sequence = pickColors(LIGHT_FRAMES)
    const signal: number[] = []
    let level = 0.2
    let step = 0
    let stepStart = 0

    this.beginSession()
    this.setRow(CHECK_ORDER[0], { status: 'running', detail: CHECK_RUNNING[CHECK_ORDER[0]] })
    this.update({
      progress: {
        current: CHECK_ORDER[0],
        step: 1,
        total: CHECK_ORDER.length,
        fraction: 0,
        signal: [],
        signalCapacity: SIGNAL_CAPACITY,
      },
    })

    this.ticker = setInterval(() => {
      const now = Date.now()
      const elapsed = now - startedAt

      while (step < CHECK_ORDER.length && elapsed >= stepStart + STEP_MS[CHECK_ORDER[step]]) {
        const done = CHECK_ORDER[step]
        this.finishCheck(done, plan[done], now)
        stepStart += STEP_MS[done]
        step++
        const next = CHECK_ORDER[step]
        if (next) this.setRow(next, { status: 'running', detail: CHECK_RUNNING[next] })
      }
      if (step >= CHECK_ORDER.length) {
        this.stop()
        this.complete(plan, now)
        return
      }

      const current = CHECK_ORDER[step]
      let swatch: string | undefined
      if (current === 'light') {
        const frame = Math.min(Math.floor((elapsed - stepStart) / LIGHT_FRAME_MS), sequence.length - 1)
        swatch = sequence[frame]
        // A covered camera barely reacts to the flashes.
        const target = plan.light.status === 'pass' ? luminance(swatch) : 0.08
        level = clamp01(level + (target - level) * 0.35 + (Math.random() - 0.5) * 0.04)
        signal.push(level)
      }
      this.update({
        progress: {
          current,
          step: step + 1,
          total: CHECK_ORDER.length,
          fraction: Math.min(elapsed / RUN_MS, 1),
          swatch,
          signal: [...signal],
          signalCapacity: SIGNAL_CAPACITY,
        },
      })
    }, TICK_MS)
  }

  /** Same outcome as a full run, without the wait (dev scenarios). */
  private completeInstantly(plan: Plan): void {
    const now = Date.now()
    this.beginSession(now - RUN_MS)
    let t = now - RUN_MS
    for (const kind of CHECK_ORDER) {
      t += STEP_MS[kind]
      this.finishCheck(kind, plan[kind], t)
    }
    this.complete(plan, now)
  }

  private beginSession(at = Date.now()): void {
    this.update({
      sessionId: `ses_${Array.from(randomBytes(6), (b) => b.toString(16).padStart(2, '0')).join('')}`,
      verdict: { status: 'checking' },
      checks: idleRows(),
      progress: null,
      token: null,
      alert: null,
      environment: { ...this.state.environment, changed: undefined },
    })
    this.log('info', `Check started — ${CHECK_ORDER.length} challenges issued`, at)
  }

  private finishCheck(kind: ChallengeKind, result: MockResult, at: number): void {
    this.setRow(kind, {
      status: result.status,
      detail: result.detail,
      score: result.score,
      reasons: result.reasons,
      at,
    })
    this.log(toneFor(result.status), checkMessage(kind, result), at)
  }

  private complete(plan: Plan, now: number): void {
    const results: CheckOutcomeResult[] = CHECK_ORDER.map((kind) => ({
      kind,
      status: plan[kind].status,
      score: plan[kind].score,
      reasons: plan[kind].reasons,
    }))
    const verdict = deriveVerdict(results, now)
    let token: TrustToken | null = null

    if (verdict.status === 'verified') {
      token = {
        jwt: mockJwt(this.state.sessionId ?? 'ses_mock', results, now, verdict.expiresAt),
        issuedAt: now,
        expiresAt: verdict.expiresAt,
      }
      this.after(verdict.expiresAt - now, () => this.expire())
    }
    this.update({ verdict, token, progress: null })

    if (verdict.status === 'verified') {
      this.log('pass', `Verified — trust token issued, valid ${Math.round((verdict.expiresAt - now) / 1000)} s`, now)
    } else if (verdict.status === 'not_verified') {
      this.log('fail', `Not verified — ${verdict.failing.map((k) => CHECK_LABEL[k]).join(', ')} failed`, now)
    } else if (verdict.status === 'needs_review') {
      this.log('review', `Needs review — ${verdict.reviewing.map((k) => CHECK_LABEL[k]).join(', ')}`, now)
    } else if (verdict.status === 'unable') {
      this.log('review', `Unable to verify — ${verdict.reason}`, now)
    }
  }

  private expire(): void {
    const { verdict } = this.state
    if (verdict.status !== 'verified') return
    this.update({
      verdict: { status: 'unable', at: verdict.expiresAt, cause: 'expired', reason: 'Result expired' },
      token: null,
    })
    this.log('review', 'Result expired — run a new check')
  }

  private changeDevice(change: DeviceChange): void {
    this.stop()
    const at = Date.now()
    const key = change.device === 'camera' ? 'camera' : 'mic'
    const noun = change.device === 'camera' ? 'Camera' : 'Microphone'
    this.update({
      environment: { ...this.state.environment, [key]: change.to, changed: key },
      verdict: { status: 'unable', at, cause: 'device_changed', reason: 'Device changed mid-call' },
      token: null,
      progress: null,
      alert: {
        id: nextId(),
        at,
        title: 'Device changed mid-call',
        message: `${noun} switched from “${change.from}” to “${change.to}” (${change.reason.toLowerCase()}). The earlier result no longer applies.`,
      },
    })
    this.log('review', `${noun} changed mid-call: ${change.from} → ${change.to}`, at)
  }

  private reset(): void {
    this.stop()
    this.state = initialState()
    this.emit()
  }

  private stop(): void {
    if (this.ticker) clearInterval(this.ticker)
    this.ticker = null
    for (const t of this.timers) clearTimeout(t)
    this.timers.clear()
  }

  private after(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t)
      fn()
    }, ms)
    this.timers.add(t)
  }

  private setRow(kind: ChallengeKind, patch: Partial<CheckRow>): void {
    this.update({ checks: this.state.checks.map((row) => (row.kind === kind ? { ...row, ...patch } : row)) })
  }

  private log(tone: ActivityTone, message: string, at = Date.now()): void {
    this.update({ activity: [{ id: nextId(), at, tone, message }, ...this.state.activity].slice(0, 50) })
  }

  private update(patch: Partial<KnockState>): void {
    this.state = { ...this.state, ...patch }
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener(this.state)
  }
}
