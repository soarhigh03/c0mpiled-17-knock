import { useState } from 'react'
import type { KnockClient } from '../knock/types.ts'
import { CandidateCall } from './CandidateCall.tsx'
import { PreJoin, type JoinSelection } from './PreJoin.tsx'

interface CandidateAppProps {
  client: KnockClient
  /** Composition-root hook, e.g. to have the mock simulate the interviewer requesting a check. */
  onJoined?: () => void
}

export function CandidateApp({ client, onJoined }: CandidateAppProps) {
  const [joined, setJoined] = useState<JoinSelection | null>(null)

  if (!joined) {
    return (
      <PreJoin
        onJoin={(selection) => {
          setJoined(selection)
          onJoined?.()
        }}
      />
    )
  }
  return <CandidateCall client={client} {...joined} onLeave={() => setJoined(null)} />
}
