import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CHALLENGE_PALETTE, CHALLENGE_PHRASES, CHALLENGE_STEPS, createMockChallenge } from './mockClient.ts'
import type { CheckOutcome, CheckOutcomeResult } from './types.ts'
import { deriveVerdict } from './verdict.ts'

const results = (statuses: Partial<Record<CheckOutcomeResult['kind'], CheckOutcome>>): CheckOutcomeResult[] =>
  (['environment', 'light', 'sonar', 'voice'] as const).map((kind) => ({
    kind,
    status: statuses[kind] ?? 'pass',
    score: 0.5,
    reasons: statuses[kind] && statuses[kind] !== 'pass' ? [`${kind} ${statuses[kind]}`] : [],
  }))

describe('deriveVerdict', () => {
  it('all pass → verified for 30 s', () => {
    const v = deriveVerdict(results({}), 1000)
    assert.equal(v.status, 'verified')
    assert.equal(v.status === 'verified' && v.expiresAt, 31_000)
  })
  it('suspected synthetic voice alone → needs review, not a veto', () => {
    assert.equal(deriveVerdict(results({ voice: 'review' }), 0).status, 'needs_review')
  })
  it('fail beats unable beats review', () => {
    assert.equal(deriveVerdict(results({ voice: 'review', light: 'fail', sonar: 'inconclusive' }), 0).status, 'not_verified')
    assert.equal(deriveVerdict(results({ voice: 'review', sonar: 'inconclusive' }), 0).status, 'unable')
    assert.equal(deriveVerdict(results({ voice: 'review', sonar: 'skipped' }), 0).status, 'unable')
  })
})

describe('mock challenge', () => {
  it('phrases are 10–14 words (about 4–6 s read aloud)', () => {
    for (const phrase of CHALLENGE_PHRASES) {
      const words = phrase.split(/\s+/).length
      assert.ok(words >= 10 && words <= 14, `${words} words: ${phrase}`)
    }
  })
  it('uses palette colors with no back-to-back repeats', () => {
    for (let n = 0; n < 50; n++) {
      const { colors } = createMockChallenge('Jordan Lee')
      assert.equal(colors.length, CHALLENGE_STEPS)
      colors.forEach((c, i) => {
        assert.ok(CHALLENGE_PALETTE.includes(c))
        if (i > 0) assert.notEqual(c, colors[i - 1])
      })
    }
  })
})
