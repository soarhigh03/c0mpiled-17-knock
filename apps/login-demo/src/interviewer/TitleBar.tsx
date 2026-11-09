import { Lock } from 'lucide-react'

export function TitleBar({ candidateName, elapsed }: { candidateName: string; elapsed?: string }) {
  return (
    <header className="titlebar">
      <div className="titlebar__title">Knock · Interview with {candidateName}</div>
      {elapsed && <span className="titlebar__elapsed tabular">{elapsed}</span>}
      <div className="secure-pill">
        <Lock size={12} strokeWidth={2.25} aria-hidden />
        Secure session · capture blocked
      </div>
    </header>
  )
}
