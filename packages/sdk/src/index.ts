export { createKnock, type KnockClient, type KnockOptions, type RunContext } from './client.ts'

/** Raw sonar probe, for hardware bring-up. The verdict still comes from the server. */
export {
  probeSonar,
  type CarrierReading,
  type DopplerSample,
  type SonarProbeOptions,
  type SonarSignals,
} from './challenges/sonar.ts'
/** Raw light probe, for hardware bring-up. The verdict still comes from the server. */
export {
  probeLight,
  type LightFrame,
  type LightProbeOptions,
  type LightSignals,
} from './challenges/light.ts'
export type { FaceModelOptions, VideoClock } from './challenges/face.ts'
export type { MouthSample } from './challenges/mouth.ts'
export {
  sweepCarrierResponse,
  type SweepOptions,
  type SweepPoint,
} from './challenges/sweep.ts'

export type {
  ChallengeKind,
  CheckResult,
  LightPulse,
  Verdict,
  VerifyResponse,
} from '@knock/shared'
