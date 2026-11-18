import { createContext, useContext } from 'react'

export interface Lock {
  /** 'on' means the data on this device is encrypted and the app is unlocked right now. */
  status: 'off' | 'on'
  /** Whether this browser can make passkeys at all (it may still lack PRF; enable() says so). */
  supported: boolean
  /** The passkey's name, e.g. "Jhapi on iPhone". */
  label: string
  /** Minutes away before the app locks itself. */
  autoLockMinutes: number
  enable(): Promise<void>
  disable(): Promise<void>
  lockNow(): Promise<void>
}

export const LockCtx = createContext<Lock | null>(null)

/** Null when the app runs without the lock gate (tests of single screens). */
export function useLock(): Lock | null {
  return useContext(LockCtx)
}
