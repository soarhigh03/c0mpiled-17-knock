import { createContext, useContext, useMemo, useSyncExternalStore } from 'react'
import type { KnockClient, KnockState } from './types.ts'

/** One KnockClient per call participant, keyed by participant id. */
export type KnockClients = Record<string, KnockClient>

export const KnockContext = createContext<KnockClients | null>(null)

export function useKnockClients(): KnockClients {
  const clients = useContext(KnockContext)
  if (!clients) throw new Error('useKnockClients must be used inside <KnockContext>')
  return clients
}

/** Combines several clients into one external store with a stable snapshot. */
function combine(clients: KnockClients) {
  const ids = Object.keys(clients)
  let last: KnockState[] = []
  let value: Record<string, KnockState> = {}
  return {
    subscribe(onChange: () => void) {
      const offs = ids.map((id) => clients[id].subscribe(() => onChange()))
      return () => offs.forEach((off) => off())
    },
    getSnapshot(): Record<string, KnockState> {
      const states = ids.map((id) => clients[id].getState())
      if (states.length === last.length && states.every((s, i) => s === last[i])) return value
      last = states
      value = Object.fromEntries(ids.map((id, i) => [id, states[i]]))
      return value
    },
  }
}

export function useKnockStates(clients: KnockClients): Record<string, KnockState> {
  const store = useMemo(() => combine(clients), [clients])
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
