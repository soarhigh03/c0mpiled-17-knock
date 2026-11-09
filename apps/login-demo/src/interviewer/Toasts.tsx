import { ShieldAlert, TriangleAlert, X } from 'lucide-react'
import type { CallAlert } from './useKnockAlerts.ts'

interface ToastsProps {
  toasts: CallAlert[]
  onOpen: (toast: CallAlert) => void
  onDismiss: (id: string) => void
}

export function Toasts({ toasts, onOpen, onDismiss }: ToastsProps) {
  if (toasts.length === 0) return null
  return (
    <div className="toasts" role="region" aria-label="preSense alerts">
      {toasts.map((toast) => {
        const Icon = toast.tone === 'fail' ? ShieldAlert : TriangleAlert
        return (
          <div key={toast.id} className={`toast toast--${toast.tone}`} role="alert">
            <Icon size={16} className="toast__icon" aria-hidden />
            <span className="toast__message">{toast.message}</span>
            <button type="button" className="toast__action" onClick={() => onOpen(toast)}>
              Open preSense
            </button>
            <button type="button" className="icon-button" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
