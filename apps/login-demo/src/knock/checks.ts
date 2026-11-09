import type { ChallengeKind } from '@knock/shared'

/** Order in which checks run and are listed. */
export const CHECK_ORDER: readonly ChallengeKind[] = ['environment', 'light', 'sonar', 'voice']

export const CHECK_LABEL: Record<ChallengeKind, string> = {
  environment: 'Environment',
  light: 'Light response',
  sonar: 'Sonar presence',
  voice: 'Voice liveness',
}

/** What each check looks at; shown before it has a result. */
export const CHECK_HINT: Record<ChallengeKind, string> = {
  environment: 'Virtual devices, focus and displays',
  light: 'Screen flashes reflected on the face',
  sonar: 'Ultrasonic echo follows mouth motion',
  voice: 'Read-aloud phrase, no synthetic speech',
}

export const CHECK_RUNNING: Record<ChallengeKind, string> = {
  environment: 'Scanning devices and focus…',
  light: 'Flashing challenge colors…',
  sonar: 'Listening for ~15 s while they talk…',
  voice: 'Listening to read-aloud phrase…',
}

/** Lower-case noun for sentences like "voice check failed". */
export const CHECK_NOUN: Record<ChallengeKind, string> = {
  environment: 'environment',
  light: 'light',
  sonar: 'sonar',
  voice: 'voice',
}
