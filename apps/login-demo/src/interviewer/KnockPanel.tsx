import { FileText, Mic, Monitor, ScanFace, ShieldCheck, User, Video, X } from 'lucide-react'
import { useState } from 'react'
import type { EnvironmentSnapshot, KnockState, OverallVerdict } from '../knock/types.ts'
import { ActivityFeed } from './ActivityFeed.tsx'
import { ChecksList } from './ChecksList.tsx'
import { initials, type Participant } from './participants.ts'
import { shortStatus } from './present.ts'
import { StatusCard } from './StatusCard.tsx'
import { TokenBlock } from './TokenBlock.tsx'

interface KnockPanelProps {
  participants: Participant[]
  verdicts: Record<string, OverallVerdict>
  selected: Participant
  state: KnockState
  now: number
  onSelect: (id: string) => void
  onClose: () => void
  onRunCheck: () => void
  onOpenReport: () => void
}

function EnvironmentChips({ environment }: { environment: EnvironmentSnapshot }) {
  const cls = (key: EnvironmentSnapshot['changed']) => (environment.changed === key ? 'chip chip--review' : 'chip')
  return (
    <div className="env-chips">
      <span className={cls('camera')} title={environment.camera}>
        <Video size={12} aria-hidden />
        {environment.camera}
      </span>
      <span className={cls('mic')} title={environment.mic}>
        <Mic size={12} aria-hidden />
        {environment.mic}
      </span>
      <span className={cls('displays')}>
        <Monitor size={12} aria-hidden />
        {environment.displays} {environment.displays === 1 ? 'display' : 'displays'}
      </span>
    </div>
  )
}

export function KnockPanel(props: KnockPanelProps) {
  const { participants, verdicts, selected, state, now } = props
  const [showAlternative, setShowAlternative] = useState(false)
  const verdict = verdicts[selected.id]
  const checking = verdict.status === 'checking'
  const hasReport = state.checks.some((c) => c.at !== undefined)

  return (
    <aside className="panel" aria-label="Knock">
      <header className="panel__head">
        <div className="brand">
          <span className="brand__logo">
            <ScanFace size={15} aria-hidden />
          </span>
          Knock
        </div>
        <button type="button" className="icon-button" aria-label="Close Knock panel" onClick={props.onClose}>
          <X size={16} />
        </button>
      </header>

      <div className="selector" role="tablist" aria-label="Participant">
        {participants.map((p) => {
          const status = shortStatus(verdicts[p.id])
          const active = p.id === selected.id
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={active ? 'selector__chip is-active' : 'selector__chip'}
              title={`${p.name} · ${status.text}`}
              onClick={() => props.onSelect(p.id)}
            >
              <span className="selector__avatar" style={{ background: p.avatarColor }}>
                {p.video === 'self' ? <User size={14} aria-hidden /> : initials(p.name)}
                <span className={`selector__dot dot--${status.tone}`} aria-hidden />
              </span>
              {p.name === 'You' ? 'You' : p.name.split(' ')[0]}
            </button>
          )
        })}
      </div>

      <div className="panel__body">
        <div className="panel__subject">
          <span>{selected.name}</span>
          <span className="muted">{selected.role}</span>
        </div>
        <StatusCard verdict={verdict} progress={state.progress} now={now} />
        {verdict.status === 'verified' && state.token && <TokenBlock token={state.token} now={now} />}
        <EnvironmentChips environment={state.environment} />

        <section>
          <div className="section-head">
            <h3>Checks</h3>
            {hasReport && (
              <button type="button" className="link-button" onClick={props.onOpenReport}>
                <FileText size={13} aria-hidden />
                View report
              </button>
            )}
          </div>
          <ChecksList checks={state.checks} verdict={verdict} />
        </section>

        <section>
          <div className="section-head">
            <h3>Activity</h3>
          </div>
          <ActivityFeed entries={state.activity} />
        </section>
      </div>

      <div className="panel__actions">
        {showAlternative && (
          <p className="alt-hint">
            Hang up and call {selected.name === 'You' ? 'back' : selected.name} on a number you already have, or ask
            something only they would know. Don't use contact details given during this call.
          </p>
        )}
        <div className="panel__buttons">
          <button type="button" className="button button--accent" onClick={props.onRunCheck} disabled={checking}>
            <ShieldCheck size={15} aria-hidden />
            {checking ? 'Checking…' : 'Run check now'}
          </button>
          <button
            type="button"
            className="button button--outline"
            aria-expanded={showAlternative}
            onClick={() => setShowAlternative((v) => !v)}
          >
            Verify another way
          </button>
        </div>
      </div>

      <footer className="panel__foot">
        Knock checks that a live person is responding in this call. It does not prove identity or approve payments.
      </footer>
    </aside>
  )
}
