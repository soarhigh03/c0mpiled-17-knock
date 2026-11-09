import type { CheckResult, Verdict } from '@knock/shared'
import { config } from '../config.ts'

/** Weights reflect how hard each check is to fool. Tune during the hackathon. */
const WEIGHTS: Record<CheckResult['kind'], number> = {
  sonar: 0.4,
  light: 0.3,
  environment: 0.15,
  voice: 0.15,
}

export function aggregate(sessionId: string, checks: CheckResult[]): Verdict {
  const counted = checks.filter((c) => c.status !== 'skipped')
  const totalWeight = counted.reduce((s, c) => s + WEIGHTS[c.kind], 0)
  const score =
    totalWeight === 0 ? 0 : counted.reduce((s, c) => s + WEIGHTS[c.kind] * c.score, 0) / totalWeight

  // Any hard failure vetoes, regardless of the weighted score.
  const vetoed = counted.some((c) => c.status === 'fail')

  return {
    sessionId,
    human: !vetoed && counted.length > 0 && score >= config.humanThreshold,
    score,
    checks,
  }
}
