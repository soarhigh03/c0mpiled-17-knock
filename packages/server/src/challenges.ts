import { randomInt } from 'node:crypto'
import type { Challenge, ChallengeKind, LightPulse } from '@knock/shared'

/**
 * Panel colors. Every channel is either fully on or fully off, and six of the
 * seven are drawn per session, so each of r/g/b is high in at least one pulse
 * and low in another whichever one is left out. That matters: the verifier
 * correlates the three channels separately against their own templates, and a
 * channel that never varies contributes nothing — it is also what makes the
 * statistic chromatic rather than a brightness detector. Black is excluded; it
 * is the panels' idle state.
 */
const LIGHT_PALETTE = ['#ff0000', '#00ff00', '#0000ff', '#00ffff', '#ff00ff', '#ffff00', '#ffffff']
const LIGHT_PULSES = 6
/**
 * The verifier wants at least three frames strictly inside a pulse, after it
 * discards the part-lit frames at each edge. The face landmarker, not the
 * camera, sets that rate — 23 fps was measured for sonar and CPU inference is
 * slower — so this is sized to clear the bar at about 12 fps. Longer than that
 * starts giving the camera's exposure control, which settles over a few
 * hundred ms, time to compensate the flash away before it was recorded.
 */
const LIGHT_HOLD_MS = 320
/**
 * Dark gap after a pulse: the baseline it is scored against. Has to hold a
 * full hold-length window plus the verifier's guard either side of it.
 */
const LIGHT_GAP_MIN_MS = 440
/** Jitter on top of the minimum gap. This is the replay defence. */
const LIGHT_GAP_JITTER_MS = 520
/** Dark ring on screen before the first pulse, for exposure to settle. */
const LIGHT_LEAD_IN_MS = 700

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
      return { kind, ...lightSchedule() }
    case 'sonar':
      // 18–20 kHz: above the speech band, below where laptop speakers die out.
      // The frequency is the replay defence — see SonarChallenge.
      // 15s. The check is passive — it observes whatever the candidate is
      // already saying — so the window has to be long enough to catch real
      // speech without asking for any. More samples also pull the chance
      // correlation down, which is what the verdict is measured against.
      return { kind, carrierHz: 18_000 + randomInt(0, 2_001), durationMs: 15_000 }
    case 'voice':
      return { kind, phrase: PHRASES[randomInt(PHRASES.length)]! }
  }
}

/**
 * Six pulses at unpredictable times in six distinct colors, roughly 5–8s all
 * told. A recording cannot know either, and the verifier needs the colors to
 * span the channels — see LIGHT_PALETTE.
 */
function lightSchedule(): { pulses: LightPulse[]; durationMs: number } {
  const colors = shuffled(LIGHT_PALETTE).slice(0, LIGHT_PULSES)
  const pulses: LightPulse[] = []
  let cursor = LIGHT_LEAD_IN_MS
  for (const color of colors) {
    pulses.push({ atMs: cursor, holdMs: LIGHT_HOLD_MS, color })
    cursor += LIGHT_HOLD_MS + LIGHT_GAP_MIN_MS + randomInt(LIGHT_GAP_JITTER_MS)
  }
  // `cursor` already includes the gap after the last pulse, which the verifier
  // needs as that pulse's trailing baseline.
  return { pulses, durationMs: cursor }
}

/** Fisher–Yates on the CSPRNG; `Math.random` has no place in a challenge. */
function shuffled<T>(items: readonly T[]): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1)
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  return out
}
