import { Shield, ShieldAlert, ShieldCheck, ShieldQuestionMark } from 'lucide-react'
import { CHECK_LABEL, CHECK_RUNNING } from '../knock/checks.ts'
import type { CheckProgress, OverallVerdict } from '../knock/types.ts'
import { VERDICT_TTL_MS } from '../knock/verdict.ts'
import { secondsLeft } from './present.ts'
import { Sparkline } from './Sparkline.tsx'

interface StatusCardProps {
  verdict: OverallVerdict
  progress: CheckProgress | null
  now: number
}

const UNABLE_DETAIL = {
  expired: 'The last pass is more than 30 s old. Run a new check before acting on anything sensitive.',
  device_changed: 'A camera, mic or display changed during the call, so the earlier result no longer applies.',
} as const

export function StatusCard({ verdict, progress, now }: StatusCardProps) {
  switch (verdict.status) {
    case 'idle':
      return (
        <section className="status-card status-card--idle">
          <div className="status-card__head">
            <Shield size={20} aria-hidden />
            <h2>No check yet</h2>
          </div>
          <p>Run a check to confirm a live person is responding before you act on anything sensitive.</p>
        </section>
      )

    case 'checking': {
      const pct = Math.round((progress?.fraction ?? 0) * 100)
      return (
        <section className="status-card status-card--checking" aria-live="polite">
          <div className="status-card__head">
            <Shield size={20} aria-hidden />
            <h2>Checking…</h2>
            <span className="status-card__aside tabular">{pct}%</span>
          </div>
          <div className="bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="bar__fill bar__fill--accent" style={{ width: `${pct}%` }} />
          </div>
          {progress && (
            <p className="status-card__step">
              Step {progress.step} of {progress.total} · {CHECK_LABEL[progress.current]} —{' '}
              {CHECK_RUNNING[progress.current]}
            </p>
          )}
          <div className="signal">
            <div className="signal__swatch">
              <span
                className="swatch"
                style={progress?.swatch ? { background: progress.swatch } : undefined}
                aria-hidden
              />
              <div>
                <div className="signal__label">Challenge color</div>
                <div className="mono">{progress?.swatch ?? '—'}</div>
              </div>
            </div>
            <div className="signal__chart">
              <div className="signal__label">Light response</div>
              <Sparkline
                values={progress?.signal ?? []}
                capacity={progress?.signalCapacity ?? 2}
                label="Light-response signal"
              />
            </div>
          </div>
        </section>
      )
    }

    case 'verified': {
      const left = secondsLeft(verdict.expiresAt, now)
      const fraction = Math.max(0, Math.min(1, (verdict.expiresAt - now) / VERDICT_TTL_MS))
      return (
        <section className="status-card status-card--pass">
          <div className="status-card__head">
            <ShieldCheck size={20} aria-hidden />
            <h2>Verified</h2>
            <span className="status-card__aside tabular">Valid for {left} s</span>
          </div>
          <p>A live person responded to every check in this call.</p>
          <div className="bar" aria-label={`Valid for ${left} seconds`}>
            <div className="bar__fill bar__fill--pass" style={{ width: `${fraction * 100}%` }} />
          </div>
        </section>
      )
    }

    case 'not_verified':
      return (
        <section className="status-card status-card--fail" role="alert">
          <div className="status-card__head">
            <ShieldAlert size={20} aria-hidden />
            <h2>Not verified</h2>
          </div>
          <p>
            <strong>{verdict.failing.map((k) => CHECK_LABEL[k]).join(', ')} failed.</strong> {verdict.reason}.
          </p>
          <div className="recommend">
            <div className="recommend__label">Recommended</div>
            <p>
              Don't act on payment or sensitive requests in this call. Verify another way — call back on a number
              you already have.
            </p>
          </div>
        </section>
      )

    case 'unable':
      return (
        <section className="status-card status-card--unable">
          <div className="status-card__head">
            <ShieldQuestionMark size={20} aria-hidden />
            <h2>{verdict.cause === 'expired' ? 'Unable to verify — result expired' : 'Unable to verify'}</h2>
          </div>
          {verdict.cause !== 'expired' && <p className="status-card__reason">{verdict.reason}</p>}
          <p>{verdict.cause === 'inconclusive' ? 'Ask the candidate to fix this, then run the check again.' : UNABLE_DETAIL[verdict.cause]}</p>
        </section>
      )
  }
}
