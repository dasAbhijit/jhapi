import { createContext, useContext } from 'react'
import type { Txn } from '../core/records'
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
  saveTxn(t: Txn): void
  resolveReview(id: string, resolved: boolean): void
  clearNotice(): void
}

export const Ctx = createContext<Store | null>(null)

export function useStore(): Store {
  const s = useContext(Ctx)
  if (!s) throw new Error('useStore outside StoreProvider')
  return s
}
