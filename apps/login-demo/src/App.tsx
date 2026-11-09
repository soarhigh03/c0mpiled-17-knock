import { Suspense, lazy } from 'react'
import { PreJoin } from './candidate/PreJoin.tsx'
import { NativeDevices } from './debug/NativeDevices.tsx'
import { InterviewerView } from './interviewer/InterviewerView.tsx'
import { CANDIDATE_ID, PARTICIPANTS } from './interviewer/participants.ts'
import { MockKnockClient } from './knock/mockClient.ts'
import { KnockContext, type KnockClients } from './knock/useKnock.ts'

// Dev only: the import is dead code in production builds, so the switcher is not bundled.
const ScenarioSwitcher = import.meta.env.DEV ? lazy(() => import('./dev/ScenarioSwitcher.tsx')) : null

// TODO(sdk): replace with clients backed by @knock/sdk. UI code only sees the KnockClient interface.
const mocks: Record<string, MockKnockClient> = Object.fromEntries(
  PARTICIPANTS.map((p) => [p.id, new MockKnockClient()]),
)
const clients: KnockClients = mocks

const params = new URLSearchParams(window.location.search)

export function App() {
  if (params.get('debug') === 'devices') return <NativeDevices />
  if (params.get('role') === 'candidate') return <PreJoin />
  return (
    <KnockContext value={clients}>
      <InterviewerView />
      {ScenarioSwitcher && (
        <Suspense fallback={null}>
          <ScenarioSwitcher mocks={mocks} participants={PARTICIPANTS} defaultTarget={CANDIDATE_ID} />
        </Suspense>
      )}
    </KnockContext>
  )
}
