import type { ReactNode } from 'react'
import type { Tone } from './present.ts'

export function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`pill pill--${tone}`}>{children}</span>
}
