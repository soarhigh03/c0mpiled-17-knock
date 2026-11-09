import { useState } from 'react'
import type { KnockClient } from '../knock/types.ts'
import type { RoomLink } from '../room/link.ts'
import type { Room } from '../rooms.ts'
import { CandidateCall } from './CandidateCall.tsx'
import { CodeEntry } from './CodeEntry.tsx'
import { PreJoin, type JoinSelection } from './PreJoin.tsx'

export interface CandidateSession {
  client: KnockClient
  link: RoomLink
  disconnect: () => void
}

interface CandidateAppProps {
  /** Composition root: builds this window's KnockClient for the room and connects it to the room channel. */
  connect: (room: Room) => CandidateSession
}

type Step = { kind: 'code' } | { kind: 'prejoin'; room: Room } | { kind: 'call'; room: Room; selection: JoinSelection; session: CandidateSession }

export function CandidateApp({ connect }: CandidateAppProps) {
  const [step, setStep] = useState<Step>({ kind: 'code' })

  if (step.kind === 'code') return <CodeEntry onContinue={(room) => setStep({ kind: 'prejoin', room })} />

  if (step.kind === 'prejoin') {
    return (
      <PreJoin
        room={step.room}
        onJoin={(selection) => {
          // The server's environment check requires fullscreen; the Join click is the user gesture it needs.
          void document.documentElement.requestFullscreen?.().catch(() => {})
          setStep({ kind: 'call', room: step.room, selection, session: connect(step.room) })
        }}
      />
    )
  }

  return (
    <CandidateCall
      room={step.room}
      client={step.session.client}
      link={step.session.link}
      {...step.selection}
      onLeave={() => {
        step.session.disconnect()
        if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
        setStep({ kind: 'prejoin', room: step.room })
      }}
    />
  )
}
