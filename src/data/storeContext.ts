import { createContext, useContext } from 'react'
import type { Holding } from '../core/holdings'
import type { Goal } from '../core/goalPlan'
import type { Rule, Txn } from '../core/records'
import type { Snapshot } from './localStore'
import type { SheetConfig } from './sheetClient'

export interface Store {
  config: SheetConfig | null
  data: Snapshot | null
  pendingCount: number
  syncing: boolean
  readingInbox: boolean
  error: string | null
  notice: string | null
  connect(url: string, token: string): Promise<void>
  disconnect(): void
  sync(): Promise<void>
  readInbox(): Promise<void>
  refreshPrices(): Promise<void>
  refreshingPrices: boolean
  saveTxn(t: Txn): void
  saveHolding(h: Holding): void
  saveGoal(g: Goal): void
  /** Save a category rule; with `apply`, also recategorise other transactions from the same payee. */
  saveRule(r: Rule, apply?: boolean): void
  resolveReview(id: string, resolved: boolean): void
  clearNotice(): void
}

export const Ctx = createContext<Store | null>(null)

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore outside StoreProvider')
  return s
}
