import { Lock, LockOpen } from 'lucide-react'
import { CAPTURE_PROTECTION_LIMIT, CAPTURE_PROTECTION_ON } from '../environment/protection.ts'
import { useContentProtection } from '../environment/hooks.ts'

export function TitleBar({ title, elapsed }: { title: string; elapsed?: string }) {
  // Only claim protection the window actually reports.
  const protectedNow = useContentProtection()
  return (
    <header className="titlebar">
      <div className="titlebar__title">{title}</div>
      {elapsed && <span className="titlebar__elapsed tabular">{elapsed}</span>}
      {protectedNow ? (
        <div className="secure-pill" title={CAPTURE_PROTECTION_LIMIT}>
          <Lock size={12} strokeWidth={2.25} aria-hidden />
          Secure session · {CAPTURE_PROTECTION_ON}
        </div>
      ) : (
        <div className="secure-pill secure-pill--off">
          <LockOpen size={12} strokeWidth={2.25} aria-hidden />
          Capture allowed (dev)
        </div>
      )}
    </header>
  )
}
