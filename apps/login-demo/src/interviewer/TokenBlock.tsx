import { Check, Copy, KeyRound } from 'lucide-react'
import { useState } from 'react'
import type { TrustToken } from '../knock/types.ts'
import { formatClock, secondsLeft } from './present.ts'

function truncate(jwt: string): string {
  return jwt.length > 34 ? `${jwt.slice(0, 22)}…${jwt.slice(-8)}` : jwt
}

export function TokenBlock({ token, now }: { token: TrustToken; now: number }) {
  const [copied, setCopied] = useState(false)

  function copy() {
    navigator.clipboard
      .writeText(token.jwt)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => setCopied(false))
  }

  return (
    <section className="token">
      <div className="token__head">
        <KeyRound size={14} aria-hidden />
        <span>Trust token issued</span>
        <span className="token__expiry tabular">
          Expires {formatClock(token.expiresAt)} · in {secondsLeft(token.expiresAt, now)} s
        </span>
      </div>
      <div className="token__value">
        <code className="mono" title={token.jwt}>
          {truncate(token.jwt)}
        </code>
        <button type="button" className="icon-button" onClick={copy} aria-label="Copy token" title="Copy token">
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </button>
      </div>
    </section>
  )
}
