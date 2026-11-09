import type { Challenge, CheckResult, Evidence } from '@knock/shared'
import { verifyEnvironment } from './environment.ts'
import { verifyLight } from './light.ts'
import { verifySonar } from './sonar.ts'
import { verifyVoice } from './voice.ts'

export async function runVerifier(challenge: Challenge, evidence: Evidence): Promise<CheckResult> {
  if (challenge.kind !== evidence.kind) throw new Error('challenge/evidence kind mismatch')

  switch (evidence.kind) {
    case 'environment':
      return verifyEnvironment(evidence)
    case 'light':
      return verifyLight(challenge as Extract<Challenge, { kind: 'light' }>, evidence)
    case 'sonar':
      return verifySonar(challenge as Extract<Challenge, { kind: 'sonar' }>, evidence)
    case 'voice':
      return verifyVoice(challenge as Extract<Challenge, { kind: 'voice' }>, evidence)
  }
}
