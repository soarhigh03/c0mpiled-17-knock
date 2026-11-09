import { randomInt } from 'node:crypto'
import type { Challenge, ChallengeKind } from '@knock/shared'

const LIGHT_PALETTE = ['#ff0000', '#00ff00', '#0000ff', '#ffffff', '#000000', '#ffff00', '#00ffff', '#ff00ff']
const PHRASES = [
  '오늘 아침 수원은 맑고 바람이 조금 불었습니다',
  'seven quiet foxes jumped over twelve lazy dogs',
  '파란 우산을 든 사람이 세 번째 정류장에서 내렸다',
]

/** Every challenge uses server-side CSPRNG randomness → unpredictable per session. */
export function issueChallenge(kind: ChallengeKind): Challenge {
  switch (kind) {
    case 'environment':
      return { kind }
    case 'light':
      return {
        kind,
        sequence: Array.from({ length: 8 }, () => LIGHT_PALETTE[randomInt(LIGHT_PALETTE.length)]!),
        frameMs: 400,
      }
    case 'sonar': {
      const slotMs = 250
      const durationMs = 6_000
      return {
        kind,
        carriersHz: [18_500 + randomInt(0, 2_000)],
        pattern: Array.from({ length: durationMs / slotMs }, () => (randomInt(2) as 0 | 1)),
        slotMs,
        durationMs,
      }
    }
    case 'voice':
      return { kind, phrase: PHRASES[randomInt(PHRASES.length)]! }
  }
}
