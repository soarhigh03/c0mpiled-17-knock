import { Suspense, lazy, useState } from 'react'
import { CandidateApp, type CandidateSession } from './candidate/CandidateApp.tsx'
import { NativeDevices } from './debug/NativeDevices.tsx'
import { GUEST_ID, HOST_ID, roomParticipants, type Participant } from './interviewer/participants.ts'
import { InterviewerView } from './interviewer/InterviewerView.tsx'
import { RoomList } from './interviewer/RoomList.tsx'
import type { MockKnockClient } from './knock/mockClient.ts'
import { RoomGuestClient } from './knock/roomGuestClient.ts'
import { SdkKnockClient } from './knock/sdkClient.ts'
import { SelfClient } from './knock/selfClient.ts'
import { KnockContext, type KnockClients } from './knock/useKnock.ts'
import { openRoomLink, type RoomLink } from './room/link.ts'
import { connectRoomPublisher } from './room/publisher.ts'
import type { Room } from './rooms.ts'

const params = new URLSearchParams(window.location.search)
const role = params.get('role') === 'candidate' ? 'candidate' : 'interviewer'
const API_URL = import.meta.env.VITE_KNOCK_API_URL ?? 'http://localhost:8787'

// Dev only: these imports are dead code in production builds, so neither the
// scenario switcher nor the mock client is bundled. Mock data is opt-in via ⌘⇧D.
const ScenarioSwitcher = import.meta.env.DEV ? lazy(() => import('./dev/ScenarioSwitcher.tsx')) : null
const mockModule = import.meta.env.DEV && params.get('mock') === '1' ? await import('./knock/mockClient.ts') : null

interface InterviewerSession {
  room: Room
  participants: Participant[]
  clients: KnockClients
  link: RoomLink
  mocks: Record<string, MockKnockClient> | null
  dispose: () => void
}

function startRoom(room: Room): InterviewerSession {
  const participants = roomParticipants(room)
  // One link per room, owned here: it carries both the check traffic and the
  // call's video, and the two must not be able to outlive each other.
  const link = openRoomLink(room.code, 'interviewer')
  if (mockModule) {
    const mocks = { [HOST_ID]: new mockModule.MockKnockClient(), [GUEST_ID]: new mockModule.MockKnockClient() }
    return { room, participants, clients: mocks, link, mocks, dispose: () => link.close() }
  }
  const guest = new RoomGuestClient({ room, participantId: GUEST_ID, apiUrl: API_URL, requestedBy: room.host.name, link })
  return {
    room,
    participants,
    clients: { [HOST_ID]: new SelfClient(room.checks), [GUEST_ID]: guest },
    link,
    mocks: null,
    dispose: () => {
      guest.dispose()
      link.close()
    },
  }
}

let candidateMock: MockKnockClient | null = null

function connectCandidate(room: Room): CandidateSession {
  const link = openRoomLink(room.code, 'candidate')
  if (mockModule) {
    candidateMock = new mockModule.MockKnockClient()
    // Stands in for the interviewer asking for a check, to exercise the challenge screen.
    candidateMock.scheduleChallenge(4000, room.host.name)
    return { client: candidateMock, link, disconnect: () => link.close() }
  }
  const client = new SdkKnockClient({ apiUrl: API_URL, checks: room.checks, checkOnAttach: true })
  const stop = connectRoomPublisher(link, GUEST_ID, client)
  return {
    client,
    link,
    disconnect: () => {
      stop()
      link.close()
    },
  }
}

interface DevSwitcherProps {
  getMocks: () => Record<string, MockKnockClient> | null
  targets: { id: string; name: string }[]
}

function DevSwitcher({ getMocks, targets }: DevSwitcherProps) {
  if (!ScenarioSwitcher) return null
  return (
    <Suspense fallback={null}>
      <ScenarioSwitcher
        getMocks={getMocks}
        mockMode={mockModule !== null}
        targets={targets}
        defaultTarget={targets[targets.length - 1]?.id ?? ''}
        view={role}
      />
    </Suspense>
  )
}

export function App() {
  const [session, setSession] = useState<InterviewerSession | null>(null)

  if (params.get('debug') === 'devices') return <NativeDevices />

  if (role === 'candidate') {
    return (
      <>
        <CandidateApp connect={connectCandidate} />
        <DevSwitcher
          getMocks={() => (candidateMock ? { candidate: candidateMock } : null)}
          targets={[{ id: 'candidate', name: 'This window' }]}
        />
      </>
    )
  }

  if (!session) {
    return (
      <>
        <RoomList onStart={(room) => setSession(startRoom(room))} />
        <DevSwitcher getMocks={() => null} targets={[]} />
      </>
    )
  }

  return (
    <KnockContext value={session.clients}>
      <InterviewerView
        room={session.room}
        participants={session.participants}
        link={session.link}
        onLeave={() => {
          session.dispose()
          setSession(null)
        }}
      />
      <DevSwitcher getMocks={() => session.mocks} targets={session.participants} />
    </KnockContext>
  )
}
