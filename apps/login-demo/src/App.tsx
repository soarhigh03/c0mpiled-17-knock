import { Suspense, lazy } from 'react'
import { CandidateApp } from './candidate/CandidateApp.tsx'
import { NativeDevices } from './debug/NativeDevices.tsx'
import { InterviewerView } from './interviewer/InterviewerView.tsx'
import { CANDIDATE_ID, INTERVIEWER_NAME, PARTICIPANTS } from './interviewer/participants.ts'
import { MockKnockClient } from './knock/mockClient.ts'
import type { KnockClient } from './knock/types.ts'
import { KnockContext, type KnockClients } from './knock/useKnock.ts'

// Dev only: the import is dead code in production builds, so the switcher is not bundled.
const ScenarioSwitcher = import.meta.env.DEV ? lazy(() => import('./dev/ScenarioSwitcher.tsx')) : null

const params = new URLSearchParams(window.location.search)
const role = params.get('role') === 'candidate' ? 'candidate' : 'interviewer'

// TODO(sdk): replace with clients backed by @knock/sdk. UI code only sees the KnockClient interface.
const mocks: Record<string, MockKnockClient> =
  role === 'candidate'
    ? { candidate: new MockKnockClient() }
    : Object.fromEntries(PARTICIPANTS.map((p) => [p.id, new MockKnockClient()]))
const clients: KnockClients = mocks

/** Until the interviewer's "Check now" reaches the candidate over the network, the mock simulates it. */
const SIMULATED_REQUEST_DELAY_MS = 4000

export function App() {
  if (params.get('debug') === 'devices') return <NativeDevices />

  if (role === 'candidate') {
    const candidate: KnockClient = mocks.candidate
    return (
      <>
        <CandidateApp
          client={candidate}
          onJoined={() => mocks.candidate.scheduleChallenge(SIMULATED_REQUEST_DELAY_MS, INTERVIEWER_NAME)}
        />
        {ScenarioSwitcher && (
          <Suspense fallback={null}>
            <ScenarioSwitcher
              mocks={mocks}
              targets={[{ id: 'candidate', name: 'Candidate (this window)' }]}
              defaultTarget="candidate"
              view="candidate"
            />
          </Suspense>
        )}
      </>
    )
  }

  return (
    <KnockContext value={clients}>
      <InterviewerView />
      {ScenarioSwitcher && (
        <Suspense fallback={null}>
          <ScenarioSwitcher mocks={mocks} targets={PARTICIPANTS} defaultTarget={CANDIDATE_ID} view="interviewer" />
        </Suspense>
      )}
    </KnockContext>
  )
}
