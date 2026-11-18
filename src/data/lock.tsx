/**
 * The passkey lock in front of the whole app.
 *
 * - Off: LocalStore reads and writes plain localStorage, as before.
 * - On: the data on this device is encrypted (vault.ts). Every time Jhapi opens, and after it has been
 *   in the background for a few minutes, it shows the lock screen until the passkey is used.
 * - The sheet is not affected: it is protected by the owner's Google account and the secret code.
 *   A lost passkey only means this device forgets its copy and reconnects.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { LocalStore, browserKV, type KV } from './localStore'
import { LockCtx, type Lock } from './lockContext'
import { browserPasskeys, PasskeyError, type PasskeyApi } from './passkey'
import { VaultKV, deriveKey, keyFits, makeLock, readLock, sealPlain, unsealToPlain, wipeDevice, type LockRecord } from './vault'

export const AUTO_LOCK_MINUTES = 5

/** Plain storage that can be switched off, so a sync still in flight cannot write plain data after the lock is turned on. */
class GuardKV implements KV {
  private dead = false
  private readonly raw: KV
  constructor(raw: KV) {
    this.raw = raw
  }
  stop() {
    this.dead = true
  }
  resume() {
    this.dead = false
  }
  get(k: string) {
    return this.dead ? null : this.raw.get(k)
  }
  set(k: string, v: string) {
    if (!this.dead) this.raw.set(k, v)
  }
  remove(k: string) {
    if (!this.dead) this.raw.remove(k)
  }
}

type Phase =
  | { kind: 'off'; guard: GuardKV; local: LocalStore }
  | { kind: 'locked'; lock: LockRecord }
  | { kind: 'open'; lock: LockRecord; vault: VaultKV; local: LocalStore }

function offPhase(raw: KV): Phase {
  const guard = new GuardKV(raw)
  return { kind: 'off', guard, local: new LocalStore(guard) }
}

const message = (e: unknown) => (e instanceof PasskeyError || e instanceof Error ? e.message : 'Something went wrong.')

export function LockGate({
  children,
  raw = browserKV,
  passkeys,
  autoLockMinutes = AUTO_LOCK_MINUTES,
}: {
  children: (local: LocalStore) => ReactNode
  raw?: KV
  passkeys?: PasskeyApi
  autoLockMinutes?: number
}) {
  const api = useMemo(() => passkeys ?? browserPasskeys(), [passkeys])
  const [phase, setPhase] = useState<Phase>(() => {
    const lock = readLock(raw)
    return lock ? { kind: 'locked', lock } : offPhase(raw)
  })
  // Remounts the app (and its store) whenever the storage underneath changes.
  const [generation, setGeneration] = useState(0)
  const go = useCallback((p: Phase) => {
    setPhase(p)
    setGeneration((g) => g + 1)
  }, [])

  const enable = useCallback(async () => {
    if (phase.kind !== 'off') return
    const label = `Jhapi on ${phase.local.deviceName()}`
    const made = await api.create(label)
    const key = await deriveKey(made.secret)
    const lock = await makeLock(key, made.credentialId, made.salt, label)
    phase.guard.stop()
    try {
      await sealPlain(raw, key, lock)
    } catch (e) {
      phase.guard.resume()
      throw e
    }
    const vault = await VaultKV.open(raw, key)
    go({ kind: 'open', lock, vault, local: new LocalStore(vault) })
  }, [phase, api, raw, go])

  const disable = useCallback(async () => {
    if (phase.kind !== 'open') return
    await unsealToPlain(raw, phase.vault)
    go(offPhase(raw))
  }, [phase, raw, go])

  const lockNow = useCallback(async () => {
    if (phase.kind !== 'open') return
    await phase.vault.flush()
    go({ kind: 'locked', lock: phase.lock })
  }, [phase, go])

  const unlock = useCallback(async () => {
    if (phase.kind !== 'locked') return
    const secret = await api.unlock(phase.lock.credentialId, phase.lock.salt)
    const key = await deriveKey(secret)
    if (!(await keyFits(key, phase.lock))) throw new Error("That passkey doesn't open Jhapi on this device. Use the passkey named " + `“${phase.lock.label}”.`)
    const vault = await VaultKV.open(raw, key)
    go({ kind: 'open', lock: phase.lock, vault, local: new LocalStore(vault) })
  }, [phase, api, raw, go])

  const reset = useCallback(() => {
    wipeDevice(raw)
    go(offPhase(raw))
  }, [raw, go])

  // Lock after a while in the background. Reloading always starts locked.
  const hiddenAt = useRef<number | null>(null)
  useEffect(() => {
    if (phase.kind !== 'open') return
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') hiddenAt.current = Date.now()
      else if (hiddenAt.current !== null && Date.now() - hiddenAt.current >= autoLockMinutes * 60_000) void lockNow()
      if (document.visibilityState === 'visible') hiddenAt.current = null
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [phase, autoLockMinutes, lockNow])

  if (phase.kind === 'locked') return <LockScreen label={phase.lock.label} onUnlock={unlock} onReset={reset} />

  const value: Lock = {
    status: phase.kind === 'open' ? 'on' : 'off',
    supported: api.supported(),
    label: phase.kind === 'open' ? phase.lock.label : '',
    autoLockMinutes,
    enable,
    disable,
    lockNow,
  }
  return (
    <LockCtx.Provider value={value}>
      <Fragment key={generation}>{children(phase.local)}</Fragment>
    </LockCtx.Provider>
  )
}

function LockScreen({ label, onUnlock, onReset }: { label: string; onUnlock: () => Promise<void>; onReset: () => void }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const go = async () => {
    setErr(null)
    setBusy(true)
    try {
      await onUnlock()
    } catch (e) {
      setErr(message(e))
      setBusy(false)
    }
  }
  return (
    <main className="lock-screen">
      <div className="lock-box stack">
        <h1>Jhapi is locked</h1>
        <p className="muted">Your data on this device is encrypted. Use your passkey (Face ID or Touch ID) to open it.</p>
        <button type="button" className="btn primary" disabled={busy} onClick={() => void go()}>
          {busy ? 'Waiting for passkey…' : 'Unlock with passkey'}
        </button>
        {err && <p className="banner err" role="alert">{err}</p>}
        {label && <p className="muted small">The passkey is “{label}” in Passwords.</p>}
        <details>
          <summary>Can't use your passkey?</summary>
          <div className="stack">
            <p className="muted">
              This device can forget its copy and start again. Your sheet keeps everything; reconnect with the web app URL and secret code. Changes made on this device and not yet synced are lost.
            </p>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                if (window.confirm('Forget Jhapi on this device? Your sheet keeps everything. Unsynced changes on this device are lost.')) onReset()
              }}
            >
              Forget this device's copy
            </button>
          </div>
        </details>
      </div>
    </main>
  )
}
