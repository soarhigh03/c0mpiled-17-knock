export { createKnock, type KnockClient, type KnockOptions, type RunContext } from './client.ts'

/** Raw sonar probe, for hardware bring-up. The verdict still comes from the server. */
export {
  probeSonar,
  SONAR_PROMPT,
  type CarrierReading,
  type DopplerSample,
  type SonarProbeOptions,
  type SonarSignals,
} from './challenges/sonar.ts'
export type { FaceModelOptions, MouthSample } from './challenges/mouth.ts'

export type {
  ChallengeKind,
  CheckResult,
  Verdict,
  VerifyResponse,
} from '@knock/shared'
