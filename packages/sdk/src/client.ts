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
   * What the user has to do right now, e.g. "count from 1 to 10 out loud".
   * Checks that need the user's cooperation set this; `null` clears it.
   * The host app is responsible for actually showing it.
   */
  onPrompt?: (prompt: string | null) => void
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
        const evidence = await runChallenge(challenge, ctx)
        const { result } = await api.submitEvidence(session.sessionId, evidence)
        ctx.onResult?.(result)
      }
      return api.verify(session.sessionId)
    },
  }
}
