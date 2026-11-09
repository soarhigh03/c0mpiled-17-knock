import { Download, X } from 'lucide-react'
import { useEffect } from 'react'
import { CHECK_LABEL } from '../knock/checks.ts'
import type { KnockState, OverallVerdict } from '../knock/types.ts'
import { CHECK_ICON } from './icons.ts'
import { Pill } from './Pill.tsx'
import { badgeFor, formatClock, rowPill } from './present.ts'

interface ReportModalProps {
  participantName: string
  state: KnockState
  verdict: OverallVerdict
  now: number
  onClose: () => void
}

function exportJson(participantName: string, state: KnockState, verdict: OverallVerdict) {
  const report = {
    participant: participantName,
    sessionId: state.sessionId,
    generatedAt: new Date().toISOString(),
    verdict,
    checks: state.checks.map((c) => ({
      kind: c.kind,
      status: c.status,
      score: c.score ?? null,
      detail: c.detail,
      reasons: c.reasons,
      checkedAt: c.at ? new Date(c.at).toISOString() : null,
    })),
    environment: state.environment,
    activity: [...state.activity].reverse().map((a) => ({ ...a, at: new Date(a.at).toISOString() })),
  }
  const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `knock-report-${state.sessionId ?? 'session'}.json`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function ReportModal({ participantName, state, verdict, now, onClose }: ReportModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const overall = badgeFor(verdict, state.progress, now)

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__head">
          <div>
            <h2 id="report-title">Verification report · {participantName}</h2>
            <div className="muted mono">{state.sessionId ?? 'No session'}</div>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close report">
            <X size={16} />
          </button>
        </header>

        <div className="modal__body">
          <div className={`badge badge--${overall.tone} badge--flat`}>
            <span className="dot" aria-hidden />
            {overall.text}
          </div>
          <table className="report-table">
            <thead>
              <tr>
                <th scope="col">Check</th>
                <th scope="col">Result</th>
                <th scope="col">Score</th>
                <th scope="col">Checked at</th>
              </tr>
            </thead>
            <tbody>
              {state.checks.map((row) => {
                const Icon = CHECK_ICON[row.kind]
                const pill = rowPill(row, verdict)
                return (
                  <tr key={row.kind}>
                    <td>
                      <div className="report-table__check">
                        <Icon size={14} aria-hidden />
                        <div>
                          <div>{CHECK_LABEL[row.kind]}</div>
                          <div className="muted">{row.detail}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <Pill tone={pill.tone}>{pill.text}</Pill>
                    </td>
                    <td className="tabular">{row.score?.toFixed(2) ?? '—'}</td>
                    <td className="tabular">{row.at ? formatClock(row.at) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <footer className="modal__foot">
          <button type="button" className="button button--outline" onClick={onClose}>
            Close
          </button>
          <button type="button" className="button button--accent" onClick={() => exportJson(participantName, state, verdict)}>
            <Download size={14} aria-hidden />
            Export JSON
          </button>
        </footer>
      </div>
    </div>
  )
}
