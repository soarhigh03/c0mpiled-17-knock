import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { findRoom, formatRoomTime, ROOM_CODE_ALPHABET, ROOMS } from './rooms.ts'

describe('rooms', () => {
  it('has exactly the two demo rooms, with codes from the unambiguous alphabet', () => {
    assert.deepEqual(
      ROOMS.map((r) => r.code),
      ['QX7M4K', 'R9T2HF'],
    )
    for (const r of ROOMS) {
      assert.ok([...r.code].every((c) => ROOM_CODE_ALPHABET.includes(c)))
      assert.equal(r.display.replace('-', ''), r.code)
    }
  })

  it('accepts codes case-insensitively, with or without dashes', () => {
    for (const input of ['QX7M4K', 'qx7-m4k', ' Qx7 M4k ', 'r9t2hf', 'R9T-2HF']) {
      assert.equal(findRoom(input).ok, true, input)
    }
  })

  it('rejects unknown and malformed codes', () => {
    assert.deepEqual(findRoom('QX7M4J'), { ok: false, error: 'unknown' })
    assert.deepEqual(findRoom('QX7M4'), { ok: false, error: 'format' })
    // 0 and O are not in the alphabet.
    assert.deepEqual(findRoom('QX7M0K'), { ok: false, error: 'format' })
  })

  it('shows times in KST', () => {
    assert.equal(formatRoomTime(ROOMS[0]), 'Tue, Nov 10 · 10:00 KST')
    assert.equal(formatRoomTime(ROOMS[1]), 'Tue, Nov 10 · 14:30 KST')
  })
})
