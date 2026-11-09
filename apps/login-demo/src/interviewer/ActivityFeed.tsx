import type { ActivityEntry } from '../knock/types.ts'
import { formatClock } from './present.ts'

export function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  if (entries.length === 0) return <p className="muted">No activity yet.</p>
  return (
    <ol className="activity">
      {entries.map((entry) => (
        <li key={entry.id} className="activity__item">
          <span className={`dot dot--${entry.tone}`} aria-hidden />
          <span className="activity__message">{entry.message}</span>
          <time className="activity__time tabular" dateTime={new Date(entry.at).toISOString()}>
            {formatClock(entry.at)}
          </time>
        </li>
      ))}
    </ol>
  )
}
