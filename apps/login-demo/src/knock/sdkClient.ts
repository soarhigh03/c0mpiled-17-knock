import { createKnock, type KnockClient as SdkKnock } from '@knock/sdk'
import type { ChallengeKind, CheckResult } from '@knock/shared'
import { CHECK_LABEL, CHECK_RUNNING } from './checks.ts'
import { sentence } from '../interviewer/present.ts'
import { ClientStore, emptyState, jwtExpiry } from './store.ts'
import type { CheckOutcomeResult, DeviceChange, EnvironmentReport, KnockClient, OverallVerdict } from './types.ts'
import { deriveVerdict } from './verdict.ts'

/**
 * Which checks can produce a real result end to end today. Anything else is
 * shown as "Not run" and never sent, so it can't pass by default.
 *
 * - voice: the SDK sends empty audio and can't take a recording; the server
 *   verifier is not implemented.
 * - sonar runs: a passive ~15 s window that needs the candidate to be talking.
 * - light runs: the SDK puts its own panel ring around the window, so unlike
 *   the mock path it does not need the challenge screen's step timestamps.
 */
export const NOT_RUN_REASON: Record<ChallengeKind, string | null> = {
  environment: null,
  light: null,
  sonar: null,
  voice: 'Not run — SDK sends no audio and server verifier not implemented yet',
}

/** The server marks unfinished verifiers this way; never show those as results. */
const NOT_IMPLEMENTED = /not implemented/i

/** The server reports environment pass without reasons; say what it checked. */
const PASS_DETAIL: Partial<Record<ChallengeKind, string>> = {
  environment: 'Fullscreen, focus kept, one screen, no virtual device names',
}

function toOutcome(result: CheckResult): CheckOutcomeResult & { detail: string } {
  if (result.reasons.some((r) => NOT_IMPLEMENTED.test(r))) {
    return { ...result, status: 'not_run', detail: `Not run — ${result.reasons.join('; ')}` }
  }
  const detail =
    result.status === 'pass'
      ? (PASS_DETAIL[result.kind] ?? 'Passed')
      : sentence(result.reasons.join('; ') || result.status)
  return { ...result, detail }
}

interface SdkKnockClientOptions {
  apiUrl: string
  checks: readonly ChallengeKind[]
  /** Run a check as soon as media is attached (i.e. on joining). */
  checkOnAttach?: boolean
}

/** Candidate-side client backed by @knock/sdk and the verification server. */
export class SdkKnockClient extends ClientStore implements KnockClient {
  private readonly knock: SdkKnock
  private readonly checks: readonly ChallengeKind[]
  private readonly checkOnAttach: boolean
  private stream: MediaStream | null = null
  private video: HTMLVideoElement | null = null
  private panelHost: HTMLElement | null = null
  private watching = false
  private autoChecked = false

  constructor({ apiUrl, checks, checkOnAttach = false }: SdkKnockClientOptions) {
    super(emptyState(checks, 'Connected to Knock'))
    this.knock = createKnock({ apiUrl })
    this.checks = checks
    this.checkOnAttach = checkOnAttach
  }

  attachMedia(stream: MediaStream | null): void {
    this.stream = stream
    if (this.video) this.video.srcObject = stream
    if (stream && !this.watching) {
      // Focus loss is counted from here on (the server's environment rule).
      this.knock.watchEnvironment()
      this.watching = true
    }
    if (stream && this.checkOnAttach && !this.autoChecked) {
      this.autoChecked = true
      this.after(800, () => this.requestCheck())
    }
  }

  attachPanelHost(element: HTMLElement | null): void {
    this.panelHost = element
  }

  requestCheck(): void {
    void this.run()
  }

  /**
   * The SDK samples frames from this element (sonar's mouth landmarks use
   * requestVideoFrameCallback), so it has to be attached and playing, just invisible.
   */
  private videoFor(stream: MediaStream): HTMLVideoElement {
    if (!this.video) {
      this.video = document.createElement('video')
      this.video.muted = true
      this.video.playsInline = true
      this.video.setAttribute('aria-hidden', 'true')
      Object.assign(this.video.style, {
        position: 'fixed',
        left: '0',
        top: '0',
        width: '2px',
        height: '2px',
        opacity: '0',
        pointerEvents: 'none',
      })
      document.body.appendChild(this.video)
    }
    if (this.video.srcObject !== stream) {
      this.video.srcObject = stream
      void this.video.play().catch(() => {})
    }
    return this.video
  }

  private async run(): Promise<void> {
    if (this.state.verdict.status === 'checking') return
    const stream = this.stream
    if (!stream) {
      this.log('review', 'Check requested before the camera was ready')
      return
    }
    const runnable = this.checks.filter((k) => NOT_RUN_REASON[k] === null)
    this.update({
      verdict: { status: 'checking' },
      progress: null,
      token: null,
      alert: null,
      checks: this.state.checks.map((row) =>
        NOT_RUN_REASON[row.kind] === null
          ? { ...row, status: 'running', detail: CHECK_RUNNING[row.kind], reasons: [], at: undefined, score: undefined }
          : { ...row, status: 'not_run', detail: NOT_RUN_REASON[row.kind]!, reasons: [], at: undefined, score: undefined },
      ),
    })
    this.log('info', `Check started — ${runnable.map((k) => CHECK_LABEL[k]).join(', ')}`)

    try {
      const res = await this.knock.verify(runnable, {
        stream,
        video: this.videoFor(stream),
        // The light panels frame the call, not the window — see attachPanelHost.
        panelHost: this.panelHost ?? undefined,
        onResult: (result) => {
          const outcome = toOutcome(result)
          this.setRow(result.kind, { status: outcome.status, detail: outcome.detail, score: result.score, reasons: result.reasons, at: Date.now() })
          this.log(outcome.status === 'pass' ? 'pass' : outcome.status === 'fail' ? 'fail' : 'review', `${CHECK_LABEL[result.kind]}: ${outcome.detail}`)
        },
        // A check that threw (e.g. mic denied, landmark model unreachable) is scored "skipped" by the server.
        onCheckError: (kind, error) => {
          const message = error instanceof Error ? error.message : String(error)
          this.setRow(kind, { status: 'skipped', detail: `Couldn't run — ${message}`, reasons: [message], at: Date.now() })
          this.log('review', `${CHECK_LABEL[kind]} couldn't run: ${message}`)
        },
      })
      const now = Date.now()
      const outcomes: CheckOutcomeResult[] = this.state.checks.map((row) => ({
        kind: row.kind,
        status: row.status === 'running' || row.status === 'waiting' ? 'skipped' : row.status,
        score: row.score ?? 0,
        reasons: row.reasons,
      }))
      let verdict: OverallVerdict = deriveVerdict(outcomes, now)
      if (verdict.status === 'verified' && !res.verdict.human) {
        verdict = { status: 'unable', at: now, cause: 'inconclusive', reason: 'Server did not mark this session as a live person' }
      }
      if (verdict.status === 'verified') {
        verdict = { ...verdict, expiresAt: Math.min(verdict.expiresAt, jwtExpiry(res.token) ?? verdict.expiresAt) }
      }
      this.update({
        sessionId: res.verdict.sessionId,
        verdict,
        token: { jwt: res.token, issuedAt: now, expiresAt: jwtExpiry(res.token) ?? now },
      })
      this.log(verdict.status === 'verified' ? 'pass' : verdict.status === 'not_verified' ? 'fail' : 'review', `Server verdict: ${res.verdict.human ? 'live person' : 'not confirmed'}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.update({
        verdict: { status: 'unable', at: Date.now(), cause: 'inconclusive', reason: `Knock server error: ${message}` },
        checks: this.state.checks.map((row) => (row.status === 'running' ? { ...row, status: 'skipped', detail: 'Server unreachable' } : row)),
      })
      this.log('review', `Check failed to run: ${message}`)
    }
  }

  reportEnvironment(report: EnvironmentReport): void {
    const env = this.state.environment
    this.update({
      environment: {
        ...env,
        camera: report.activeCamera ?? env.camera,
        mic: report.activeMicrophone ?? env.mic,
        displays: report.evidence.screenCount ?? env.displays,
      },
    })
    if (report.change) this.deviceChanged(report.change)
  }

  private deviceChanged(change: DeviceChange): void {
    const at = Date.now()
    const key = change.device === 'camera' ? 'camera' : 'mic'
    this.update({
      verdict: { status: 'unable', at, cause: 'device_changed', reason: 'Device changed mid-call' },
      environment: { ...this.state.environment, [key]: change.to, changed: key },
      alert: { id: `alert-${at}`, at, title: 'Device changed mid-call', message: `${change.from} → ${change.to} (${change.reason})` },
    })
    this.log('review', `${change.device === 'camera' ? 'Camera' : 'Microphone'} changed mid-call: ${change.from} → ${change.to}`)
  }

  // TODO(sdk): @knock/sdk can't take externally rendered challenge steps or a
  // recorded clip yet, so the challenge screen is not used on this path.
  onStep(): void {}
  onChallengeAudio(): void {}
  endChallenge(): void {}
}
