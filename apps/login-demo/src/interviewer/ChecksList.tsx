import { CHECK_LABEL } from '../knock/checks.ts'
import type { CheckRow, OverallVerdict } from '../knock/types.ts'
import { CHECK_ICON } from './icons.ts'
import { Pill } from './Pill.tsx'
import { rowPill } from './present.ts'

export function ChecksList({ checks, verdict }: { checks: CheckRow[]; verdict: OverallVerdict }) {
  return (
    <ul className="checks">
      {checks.map((row) => {
        const Icon = CHECK_ICON[row.kind]
        const pill = rowPill(row, verdict)
        const failing = verdict.status === 'not_verified' && verdict.failing.includes(row.kind)
        const reviewing = verdict.status === 'needs_review' && verdict.reviewing.includes(row.kind)
        const cls = failing ? 'check-row check-row--fail' : reviewing ? 'check-row check-row--review' : 'check-row'
        return (
          <li key={row.kind} className={cls}>
            <span className={`check-row__icon check-row__icon--${pill.tone}`}>
              <Icon size={16} aria-hidden />
            </span>
            <div className="check-row__text">
              <div className="check-row__title">{CHECK_LABEL[row.kind]}</div>
              <div className="check-row__detail" title={row.detail}>
                {row.detail}
              </div>
            </div>
            <Pill tone={pill.tone}>{pill.text}</Pill>
          </li>
        )
      })}
    </ul>
  )
}
