import type { ChallengeKind } from '@knock/shared'
import { ClientStore, emptyState } from './store.ts'
import type { KnockClient } from './types.ts'

/** Your own tile: preSense checks other participants, so nothing ever runs here. */
export class SelfClient extends ClientStore implements KnockClient {
  constructor(checks: readonly ChallengeKind[]) {
    super(emptyState(checks, 'preSense checks other participants, not you'))
  }

  requestCheck(): void {}
  reportEnvironment(): void {}
  attachMedia(): void {}
  attachPanelHost(): void {}
  onStep(): void {}
  onChallengeAudio(): void {}
  endChallenge(): void {}
}
