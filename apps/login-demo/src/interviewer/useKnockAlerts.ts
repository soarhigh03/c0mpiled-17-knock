import { useEffect } from 'react'
import { CHECK_NOUN } from '../knock/checks.ts'
import type { KnockClients } from '../knock/useKnock.ts'
import type { Participant } from './participants.ts'

export interface CallAlert {
  id: string
  participantId: string
  tone: 'fail' | 'review'
  message: string
}

let alertSeq = 0

/**
 * Watches every participant's client and reports new failures and mid-call
 * device changes, so they surface even while the Knock panel is closed.
 */
export function useKnockAlerts(
  clients: KnockClients,
  participants: Participant[],
  onAlert: (alert: CallAlert) => void,
): void {
  useEffect(() => {
    const offs = Object.entries(clients).map(([participantId, client]) => {
      let prev = client.getState()
      return client.subscribe((next) => {
        const before = prev
        prev = next
        const name = participants.find((p) => p.id === participantId)?.name ?? participantId

        if (next.verdict.status === 'not_verified' && next.verdict !== before.verdict) {
          onAlert({
            id: `alert-${++alertSeq}`,
            participantId,
            tone: 'fail',
            message: `${name}: ${CHECK_NOUN[next.verdict.failing[0]]} check failed — verify another way`,
          })
        }
        if (next.verdict.status === 'needs_review' && next.verdict !== before.verdict) {
          onAlert({
            id: `alert-${++alertSeq}`,
            participantId,
            tone: 'review',
            message: `${name}: ${CHECK_NOUN[next.verdict.reviewing[0]]} check needs review — verify another way`,
          })
        }
        if (next.alert && next.alert.id !== before.alert?.id) {
          onAlert({
            id: `alert-${++alertSeq}`,
            participantId,
            tone: 'review',
            message: `${name}: ${next.alert.title.toLowerCase()} — result no longer valid`,
          })
        }
      })
    })
    return () => offs.forEach((off) => off())
  }, [clients, participants, onAlert])
}
