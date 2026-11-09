import type { Challenge, ChallengeKind, CheckResult, Evidence, VerifyResponse } from '@knock/shared'
import { KnockApi } from './api.ts'
import { collectEnvironment, resetFocusLoss, startEnvironmentWatch } from './challenges/environment.ts'
import { runLight } from './challenges/light.ts'
import { runSonar } from './challenges/sonar.ts'
import { runVoice } from './challenges/voice.ts'

export interface KnockOptions {
  /** Base URL of the Knock verification API. */
  apiUrl: string
}

/** Media the host app already owns; the SDK never opens its own camera. */
export interface RunContext {
  stream: MediaStream
  /** A <video> element playing `stream` (used for frame sampling). */
  video: HTMLVideoElement
  /** Called as each check finishes, for live UI. */
  onResult?: (result: CheckResult) => void
  /**
   * What the user has to do right now. Checks that need the user's
   * cooperation set this; `null` clears it. The host app is responsible for
   * actually showing it. `sonar` never sets it — it observes passively.
   */
  onPrompt?: (prompt: string | null) => void
  /**
   * A check that threw, e.g. because the microphone was denied. The run
   * continues without it; the server scores it `skipped`.
   */
  onCheckError?: (kind: ChallengeKind, error: unknown) => void
  /** Abandon the run. Checks stop at the next boundary and no token is issued. */
  signal?: AbortSignal
}

export interface KnockClient {
  /** Issue challenges, run them in order, and return verdict + signed trust token. */
  verify(checks: ChallengeKind[], ctx: RunContext): Promise<VerifyResponse>
  /** Begin tracking focus loss etc. Call as early as possible. */
  watchEnvironment(): () => void
}

export function createKnock(options: KnockOptions): KnockClient {
  const api = new KnockApi(options.apiUrl.replace(/\/$/, ''))

  async function runChallenge(challenge: Challenge, ctx: RunContext): Promise<Evidence> {
    switch (challenge.kind) {
      case 'environment':
        return collectEnvironment()
      case 'light':
        return runLight(challenge, ctx)
      case 'sonar':
        return runSonar(challenge, ctx)
      case 'voice':
        return runVoice(challenge, ctx)
    }
  }

  return {
    watchEnvironment: startEnvironmentWatch,

    async verify(checks, ctx) {
      // Judge this run, not everything that happened since the page loaded.
      resetFocusLoss()
      const session = await api.createSession(checks)

      for (const challenge of session.challenges) {
        if (ctx.signal?.aborted) throw new DOMException('verification aborted', 'AbortError')
        try {
          const evidence = await runChallenge(challenge, ctx)
          const { result } = await api.submitEvidence(session.sessionId, evidence)
          ctx.onResult?.(result)
        } catch (error) {
          // One check failing — a denied microphone, a landmarker that will
          // not load — must not cost the others. Submitting nothing leaves
          // the server to score it `skipped`, so the verdict reflects what
          // actually ran instead of inventing a result for what did not.
          ctx.onCheckError?.(challenge.kind, error)
        }
      }

      return api.verify(session.sessionId)
    },
  }
}
