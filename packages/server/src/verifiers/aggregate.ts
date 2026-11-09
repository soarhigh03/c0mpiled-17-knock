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
  // Only checks that reached a verdict carry evidence. Averaging an
  // `inconclusive` in at its 0.5 treats "we could not measure" as half a
  // reason to doubt, which lets an unsupported device — or a check nobody has
  // implemented yet — drag an otherwise clean session below the threshold.
  const decided = checks.filter((c) => c.status === 'pass' || c.status === 'fail')
  const decidedWeight = weightOf(decided)
  const score =
    decidedWeight === 0
      ? 0
      : decided.reduce((s, c) => s + WEIGHTS[c.kind] * c.score, 0) / decidedWeight

  // Any hard failure vetoes, regardless of the weighted score.
  const vetoed = decided.some((c) => c.status === 'fail')

  // Excluding the undecided must not mean a verdict can rest on one weak
  // check: enough of the requested battery has to have actually measured
  // something. Requested weight, not the full catalogue, so asking for a
  // subset of checks is not self-penalising.
  const requestedWeight = weightOf(checks.filter((c) => c.status !== 'skipped'))
  const coverage = requestedWeight === 0 ? 0 : decidedWeight / requestedWeight

  return {
    sessionId,
    human: !vetoed && coverage >= config.minDecidedCoverage && score >= config.humanThreshold,
    score,
    checks,
  }
}

function weightOf(checks: CheckResult[]): number {
  return checks.reduce((s, c) => s + WEIGHTS[c.kind], 0)
}
