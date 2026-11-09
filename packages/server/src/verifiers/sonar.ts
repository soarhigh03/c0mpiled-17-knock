import type { CheckResult, SonarChallenge, SonarEvidence } from '@knock/shared'

/**
 * SonarGuard-style liveness:
 *  1) Is a physical reflector moving in front of the device? (Doppler energy present)
 *  2) Does that motion match the lower-face motion seen in video? (correlate with mouthAperture)
 *
 * Note: this proves presence + lip/video consistency, NOT identity.
 * A present impostor using live face-swap will match; the light check covers that.
 *
 * TODO(signal): align timestamps, normalise both series, Pearson/xcorr with lag search.
 */
export function verifySonar(challenge: SonarChallenge, ev: SonarEvidence): CheckResult {
  if (ev.doppler.length === 0 || ev.mouthAperture.length === 0) {
    return { kind: 'sonar', status: 'inconclusive', score: 0.5, reasons: ['empty signal'] }
  }
  void challenge
  return { kind: 'sonar', status: 'inconclusive', score: 0.5, reasons: ['not implemented yet'] }
}
