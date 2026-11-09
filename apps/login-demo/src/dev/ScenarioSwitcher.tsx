import { X } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { MockKnockClient, Scenario } from '../knock/mockClient.ts'
import './ScenarioSwitcher.css'

// Dev only: App.tsx imports this behind import.meta.env.DEV, so it never ships.

const INTERVIEWER_SCENARIOS: { id: Scenario; label: string }[] = [
  { id: 'idle', label: 'Idle' },
  { id: 'checking', label: 'Checking' },
  { id: 'verified', label: 'Verified' },
  { id: 'voice_review', label: 'Voice review' },
  { id: 'light_fail', label: 'Light fail' },
  { id: 'unable', label: 'Unable' },
  { id: 'device_changed', label: 'Device changed' },
]

const CANDIDATE_SCENARIOS: { id: Scenario; label: string }[] = [
  { id: 'challenge', label: 'Challenge' },
  { id: 'idle', label: 'Reset' },
]

type DevWindow = Window & {
  __knockDev?: {
    setScenario: (scenario: Scenario, participantId: string) => void
    setAll: (scenario: Scenario) => void
    getState: (participantId: string) => unknown
    toggleSwitcher: () => void
  }
}

interface ScenarioSwitcherProps {
  /** Mock clients for the current screen, or null when running against the real SDK. */
  getMocks: () => Record<string, MockKnockClient> | null
  mockMode: boolean
  targets: { id: string; name: string }[]
  defaultTarget: string
  view: 'interviewer' | 'candidate'
}

/** Mock data is opt-in: the app runs on the real SDK unless ?mock=1. */
function setMockMode(on: boolean) {
  const url = new URL(window.location.href)
  if (on) url.searchParams.set('mock', '1')
  else url.searchParams.delete('mock')
  window.location.assign(url)
}

export default function ScenarioSwitcher({ getMocks, mockMode, targets, defaultTarget, view }: ScenarioSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [target, setTarget] = useState(defaultTarget)
  const scenarios = view === 'interviewer' ? INTERVIEWER_SCENARIOS : CANDIDATE_SCENARIOS
  const selectedTarget = targets.some((t) => t.id === target) ? target : defaultTarget

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'd') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    // Lets scripted screenshots drive scenarios without synthesising key events.
    const w = window as DevWindow
    w.__knockDev = {
      setScenario: (scenario, participantId) => getMocks()?.[participantId]?.runScenario(scenario),
      setAll: (scenario) => Object.values(getMocks() ?? {}).forEach((m) => m.runScenario(scenario)),
      getState: (participantId) => getMocks()?.[participantId]?.getState(),
      toggleSwitcher: () => setOpen((v) => !v),
    }
    return () => {
      window.removeEventListener('keydown', onKey)
      delete w.__knockDev
    }
  }, [getMocks])

  if (!open) return null
  const mocks = getMocks()

  return (
    <div className="dev-switcher" role="dialog" aria-label="Scenario switcher">
      <div className="dev-switcher__head">
        <span>{mockMode ? 'Mock data' : 'Real SDK'}</span>
        <kbd>⌘⇧D</kbd>
        <button type="button" className="icon-button" aria-label="Close scenario switcher" onClick={() => setOpen(false)}>
          <X size={13} />
        </button>
      </div>
      {mockMode && mocks && targets.length > 0 && (
        <>
          <select className="dev-switcher__target" value={selectedTarget} onChange={(e) => setTarget(e.target.value)}>
            {targets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="dev-switcher__grid">
            {scenarios.map((s) => (
              <button
                key={s.id}
                type="button"
                className="dev-switcher__item"
                onClick={() => mocks[selectedTarget]?.runScenario(s.id)}
              >
                {s.label}
              </button>
            ))}
            {view === 'interviewer' && (
              <button
                type="button"
                className="dev-switcher__item dev-switcher__item--wide"
                onClick={() => Object.values(mocks).forEach((m) => m.runScenario('verified'))}
              >
                Everyone verified
              </button>
            )}
          </div>
        </>
      )}
      {mockMode && !mocks && <p className="dev-switcher__note">Mock clients start when you open a room.</p>}
      <button
        type="button"
        className="dev-switcher__item dev-switcher__item--wide dev-switcher__mode"
        onClick={() => setMockMode(!mockMode)}
      >
        {mockMode ? 'Use real SDK (reloads)' : 'Use mock data (reloads)'}
      </button>
    </div>
  )
}
