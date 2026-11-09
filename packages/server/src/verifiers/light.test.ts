import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { LightChallenge, type LightEvidence, type LightRoi } from '@knock/shared'
import { issueChallenge } from '../challenges.ts'
import { verifyLight } from './light.ts'

/**
 * The light verifier against simulated cameras.
 *
 * What this can establish: that each branch is reachable, that the statistic
 * separates the scenarios it is supposed to separate, and that the thresholds
 * sit between them with room on both sides. What it cannot: the thresholds
 * themselves. Every amplitude here is a guess about real optics — see
 * docs/light.md §6, and docs/sonar.md §4 for what happened last time
 * simulated numbers were mistaken for measured ones.
 */

const SKIN = { r: 140, g: 105, b: 95 }
const WALL = { r: 70, g: 72, b: 75 }
/**
 * Skin reflects red far better than blue, so a blue pulse lands on the face
 * much weaker than a red one of the same screen brightness. The surround is
 * treated as neutral.
 */
const SKIN_REFLECTANCE = { r: 1, g: 0.6, b: 0.45 }
const NEUTRAL = { r: 1, g: 1, b: 1 }

type Rgb = { r: number; g: number; b: number }

interface SceneOptions {
  fps?: number
  /** Camera levels added to the face at full channel drive. */
  faceGain?: number
  surroundGain?: number
  /** Pipeline delay, which is what the verifier's lag search looks for. */
  lagMs?: number
  /** Extra delay on the face alone — a model in the path has latency. */
  faceLagMs?: number
  faceBase?: Rgb
  surroundBase?: Rgb
  /** Per-frame noise, in camera levels, after spatial averaging. */
  noise?: number
  /** Slow room/content wander, as a fraction of the base level. */
  driftAmplitude?: number
  /** Square flicker in the played content: equal on all three channels. */
  flickerAmplitude?: number
  flickerPeriodMs?: number
  faceClipped?: number
  videoClock?: LightEvidence['videoClock']
  /** Constant offset between the client's clock and the issued schedule. */
  renderOffsetMs?: number
}

function scene(challenge: LightChallenge, options: SceneOptions = {}): LightEvidence {
  const {
    fps = 24,
    faceGain = 0,
    surroundGain = 0,
    lagMs = 40,
    faceLagMs = 0,
    faceBase = SKIN,
    surroundBase = WALL,
    noise = 0.8,
    driftAmplitude = 0,
    flickerAmplitude = 0,
    flickerPeriodMs = 900,
    faceClipped = 0,
    videoClock = 'captureTime',
    renderOffsetMs = 0,
  } = options

  const random = mulberry32(0x5eed)
  const step = 1000 / fps
  const content = (t: number) =>
    1 +
    driftAmplitude * Math.sin((2 * Math.PI * t) / 2_300) +
    (flickerAmplitude > 0 && Math.sin((2 * Math.PI * t) / flickerPeriodMs) > 0 ? flickerAmplitude : 0)

  /** Panel drive, 0–1 per channel, as it was at time `t` on the client clock. */
  const panel = (t: number): Rgb => {
    for (const pulse of challenge.pulses) {
      const on = pulse.atMs + renderOffsetMs
      if (t >= on && t < on + pulse.holdMs) {
        return {
          r: Number.parseInt(pulse.color.slice(1, 3), 16) / 255,
          g: Number.parseInt(pulse.color.slice(3, 5), 16) / 255,
          b: Number.parseInt(pulse.color.slice(5, 7), 16) / 255,
        }
      }
    }
    return { r: 0, g: 0, b: 0 }
  }

  const roi = (
    base: Rgb,
    reflectance: Rgb,
    gain: number,
    t: number,
    delay: number,
    clipped: number,
  ): LightRoi => {
    const drive = panel(t - delay)
    const scale = content(t)
    const level = (channel: keyof Rgb) =>
      Math.min(
        255,
        base[channel] * scale +
          gain * reflectance[channel] * drive[channel] +
          (random() - 0.5) * 2 * noise,
      )
    return { r: level('r'), g: level('g'), b: level('b'), clipped }
  }

  const frames: LightEvidence['frames'] = []
  for (let t = 0; t <= challenge.durationMs; t += step) {
    frames.push({
      t,
      face: roi(faceBase, SKIN_REFLECTANCE, faceGain, t, lagMs + faceLagMs, faceClipped),
      surround: roi(surroundBase, NEUTRAL, surroundGain, t, lagMs, 0),
    })
  }

  return {
    kind: 'light',
    frames,
    emissions: emissionsFor(challenge, renderOffsetMs),
    videoClock,
    cameraModes: { exposure: 'continuous', whiteBalance: 'continuous' },
  }
}

/** An honest client's receipt: the issued schedule, shifted by one offset. */
function emissionsFor(challenge: LightChallenge, offsetMs = 0): LightEvidence['emissions'] {
  const out: LightEvidence['emissions'] = [{ t: offsetMs, color: '#000000' }]
  for (const pulse of challenge.pulses) {
    out.push({ t: pulse.atMs + offsetMs, color: pulse.color })
    out.push({ t: pulse.atMs + pulse.holdMs + offsetMs, color: '#000000' })
  }
  return out
}

/** Six pulses in six colors, aperiodic gaps — the shape the server issues. */
function schedule(): LightChallenge {
  const colors = ['#ff0000', '#00ffff', '#ffff00', '#0000ff', '#ffffff', '#00ff00']
  const gaps = [710, 540, 900, 630, 780, 470]
  const pulses = []
  let cursor = 700
  for (const [i, color] of colors.entries()) {
    pulses.push({ atMs: cursor, holdMs: 320, color })
    cursor += 320 + gaps[i]!
  }
  return { kind: 'light', pulses, durationMs: cursor }
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('verifyLight', () => {
  const challenge = schedule()

  it('passes a face and a scene that answer the panels together', () => {
    const result = verifyLight(challenge, scene(challenge, { faceGain: 5, surroundGain: 4 }))
    assert.equal(result.status, 'pass')
    assert.equal(result.score, 1)
  })

  it('passes a face with nothing usable behind it, at a lower score', () => {
    // A wall far enough back that the inverse square law finishes it off.
    const result = verifyLight(challenge, scene(challenge, { faceGain: 5, surroundGain: 0 }))
    assert.equal(result.status, 'pass')
    assert.ok(result.score < 1, `expected a discount, got ${result.score}`)
    assert.ok(result.score >= 0.8, `expected it to still be strong, got ${result.score}`)
  })

  it('fails a replayed video: the room is flashing and nothing in frame knows', () => {
    const result = verifyLight(challenge, scene(challenge, { driftAmplitude: 0.08 }))
    assert.equal(result.status, 'fail')
    assert.match(result.reasons[0]!, /nothing in frame responded/)
  })

  it('fails a still image', () => {
    const result = verifyLight(challenge, scene(challenge, { noise: 0 }))
    assert.equal(result.status, 'fail')
  })

  it('fails a face swap: the scene is lit by the panels, the face is not', () => {
    // The attacker is physically there, so the wall behind them reflects the
    // panels normally. Only the face is repainted, by a model that shades it
    // on its own schedule. This is the case sonar explicitly cannot see
    // (docs/sonar.md §1), and the reason `surround` is in the evidence at all.
    const result = verifyLight(challenge, scene(challenge, { faceGain: 0, surroundGain: 4 }))
    assert.equal(result.status, 'fail')
    assert.match(result.reasons[0]!, /the face is being rendered/)
  })

  it('will not call a faintly lit face a spoof', () => {
    // Half-way: the face tracks the panels but swings too little to confirm.
    // A real face sitting well back from the screen looks like this, and so
    // does a model that reproduces the flash faithfully — which is exactly
    // why this is `inconclusive` and not a verdict either way.
    const result = verifyLight(challenge, scene(challenge, { faceGain: 1.5, surroundGain: 4 }))
    assert.equal(result.status, 'inconclusive')
    assert.match(result.reasons[0]!, /too faintly to confirm/)
  })

  it('discounts a face that answers later than the scene around it', () => {
    const result = verifyLight(
      challenge,
      scene(challenge, { faceGain: 5, surroundGain: 4, faceLagMs: 170 }),
    )
    assert.equal(result.status, 'pass')
    assert.ok(result.score < 1, `expected a discount, got ${result.score}`)
  })

  it('will not fail a room too bright for the panels to compete in', () => {
    const result = verifyLight(
      challenge,
      scene(challenge, {
        faceBase: { r: 232, g: 220, b: 214 },
        surroundBase: { r: 225, g: 228, b: 230 },
      }),
    )
    assert.equal(result.status, 'inconclusive')
    assert.match(result.reasons[0]!, /ambient light/)
  })

  it('will not judge an over-exposed face', () => {
    const result = verifyLight(
      challenge,
      scene(challenge, { faceGain: 5, surroundGain: 4, faceClipped: 0.5 }),
    )
    assert.equal(result.status, 'inconclusive')
    assert.match(result.reasons[0]!, /over-exposed/)
  })

  it('will not judge a landmarker too slow to put frames inside the pulses', () => {
    const result = verifyLight(challenge, scene(challenge, { fps: 8, faceGain: 5, surroundGain: 4 }))
    assert.equal(result.status, 'inconclusive')
    assert.match(result.reasons[0]!, /too few frames inside the pulses/)
  })

  it('still measures a landmarker running at 12 fps', () => {
    // The hold is sized for exactly this: below it the check goes quiet rather
    // than reaching a verdict off one frame pair per pulse.
    const result = verifyLight(challenge, scene(challenge, { fps: 12, faceGain: 5, surroundGain: 4 }))
    assert.equal(result.status, 'pass', result.reasons.join(' / '))
  })

  it('finds the response on the callback clock too, with a wider search', () => {
    // No captureTime means every frame carries the camera pipeline delay.
    const result = verifyLight(
      challenge,
      scene(challenge, { faceGain: 5, surroundGain: 4, lagMs: 220, videoClock: 'callback' }),
    )
    assert.equal(result.status, 'pass')
  })

  it('tolerates one constant clock offset between client and schedule', () => {
    const result = verifyLight(
      challenge,
      scene(challenge, { faceGain: 5, surroundGain: 4, renderOffsetMs: 1_400 }),
    )
    assert.equal(result.status, 'pass')
  })

  describe('a client that cannot be taken at its word', () => {
    const live = () => scene(challenge, { faceGain: 5, surroundGain: 4 })

    it('refuses evidence whose pulses wandered individually', () => {
      // Per-pulse freedom is what a template-mining client would need: shift
      // each onset until it lands on something the replay happens to do.
      const ev = live()
      const emissions = ev.emissions.map((e, i) => (i === 3 ? { ...e, t: e.t + 400 } : e))
      const result = verifyLight(challenge, { ...ev, emissions })
      assert.equal(result.status, 'inconclusive')
      assert.match(result.reasons[0]!, /drifted from the issued schedule/)
    })

    it('refuses colors it did not issue', () => {
      const ev = live()
      const emissions = ev.emissions.map((e) =>
        e.color === '#ff0000' ? { ...e, color: '#ff00ff' } : e,
      )
      const result = verifyLight(challenge, { ...ev, emissions })
      assert.equal(result.status, 'inconclusive')
      assert.match(result.reasons[0]!, /did not render the issued colors/)
    })

    it('refuses panels that never went dark again', () => {
      const ev = live()
      const result = verifyLight(challenge, {
        ...ev,
        emissions: ev.emissions.filter((e) => e.color !== '#000000'),
      })
      assert.equal(result.status, 'inconclusive')
      assert.match(result.reasons[0]!, /never went dark/)
    })

    it('is not satisfied by content that flickers on its own', () => {
      // The strongest thing a replay can offer without knowing the schedule:
      // bright flashes of its own, roughly as often as the pulses. They are
      // periodic where the schedule is not, and grey where it is colored.
      const result = verifyLight(
        challenge,
        scene(challenge, { flickerAmplitude: 0.2, flickerPeriodMs: 900 }),
      )
      assert.notEqual(result.status, 'pass')
    })
  })

  it('accepts what the server actually issues', () => {
    // Guards the schema and the schedule shape together: the verifier's
    // tolerances are tuned to the gaps and holds issueChallenge emits.
    const issued = LightChallenge.parse(issueChallenge('light'))
    const result = verifyLight(issued, scene(issued, { faceGain: 5, surroundGain: 4 }))
    assert.equal(result.status, 'pass', result.reasons.join(' / '))
  })
})
