/**
 * App state: the sheet connection, the latest copy of the sheet, and syncing.
 *
 * - Every time the app opens (and when it comes back to the foreground after a minute) it sends any
 *   unsent changes and pulls the whole sheet.
 * - Edits show at once, are queued on the device, and are pushed straight away. If the phone is
 *   offline they wait in the queue for the next sync.
 * - If the same row was changed in the sheet after the app's edit, the sheet wins.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { aliasFor, type Alias } from '../core/aliases'
import type { Holding } from '../core/holdings'
import type { Goal } from '../core/goalPlan'
import type { Rule, Txn } from '../core/records'
import { LocalStore, queueGoal, queueHolding, queueName, queueReview, queueRule, queueTxn, withPending, type Pending, type Snapshot } from './localStore'
import { SheetClient, SheetError, validateUrl, type PullResult, type SheetConfig, type Transport } from './sheetClient'
import { Ctx, type Store } from './storeContext'

const REFRESH_AFTER_MS = 60_000

function toSnapshot(r: PullResult): Snapshot {
  return {
    pulledAt: new Date().toISOString(),
    version: r.version,
    lastInboxRun: r.lastInboxRun,
    transactions: r.transactions,
    statements: r.statements,
    review: r.review,
    rules: r.rules ?? [],
    names: r.names ?? [],
    holdings: r.holdings ?? [],
    netWorth: r.netWorth ?? [],
    goals: r.goals ?? [],
    problems: r.problems,
  }
}

export function StoreProvider({ children, local = new LocalStore(), transport }: { children: ReactNode; local?: LocalStore; transport?: Transport }) {
  const [config, setConfig] = useState<SheetConfig | null>(() => local.config())
  const [snapshot, setSnapshot] = useState<Snapshot | null>(() => local.snapshot())
  const [pending, setPending] = useState<Pending>(() => local.pending())
  const [syncing, setSyncing] = useState(false)
  const [readingInbox, setReadingInbox] = useState(false)
  const [refreshingPrices, setRefreshingPrices] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const inFlight = useRef(false)
  const again = useRef(false)
  const lastSync = useRef(0)

  const client = useMemo(() => (config ? new SheetClient(config, transport) : null), [config, transport])

  const apply = useCallback(
    (r: PullResult, sent: Pending | null) => {
      const snap = toSnapshot(r)
      local.setSnapshot(snap)
      setSnapshot(snap)
      if (sent) {
        // Drop what was sent; keep anything queued while the request was in flight.
        const now = local.pending()
        const left: Pending = {
          transactions: now.transactions.filter((t) => !sent.transactions.some((s) => s.id === t.id && s.updatedAt === t.updatedAt)),
          review: now.review.filter((x) => !sent.review.some((s) => s.id === x.id && s.updatedAt === x.updatedAt)),
          rules: now.rules.filter((x) => !sent.rules.some((s) => s.id === x.id && s.updatedAt === x.updatedAt)),
          names: now.names.filter((x) => !sent.names.some((s) => s.id === x.id && s.updatedAt === x.updatedAt)),
          holdings: now.holdings.filter((x) => !sent.holdings.some((s) => s.id === x.id && s.updatedAt === x.updatedAt)),
          goals: now.goals.filter((x) => !sent.goals.some((s) => s.id === x.id && s.updatedAt === x.updatedAt)),
        }
        local.setPending(left)
        setPending(left)
      }
      if (r.rejected?.length) setNotice(`${r.rejected.length} change(s) were not saved because the row was edited in the sheet more recently.`)
      setError(null)
      lastSync.current = Date.now()
    },
    [local],
  )

  const describe = (e: unknown) => (e instanceof SheetError ? e.message : 'Something went wrong while syncing.')

  const sync = useCallback(async () => {
    if (!client) return
    if (inFlight.current) {
      again.current = true
      return
    }
    inFlight.current = true
    setSyncing(true)
    try {
      do {
        again.current = false
        const sent = local.pending()
        const hasChanges = sent.transactions.length > 0 || sent.review.length > 0 || sent.rules.length > 0 || sent.names.length > 0 || sent.holdings.length > 0 || sent.goals.length > 0
        const r = hasChanges ? await client.push(sent, local.deviceName()) : await client.pull()
        apply(r, hasChanges ? sent : null)
      } while (again.current)
    } catch (e) {
      setError(describe(e))
    } finally {
      inFlight.current = false
      setSyncing(false)
    }
  }, [client, local, apply])

  const readInbox = useCallback(async () => {
    if (!client) return
    setReadingInbox(true)
    try {
      await sync()
      apply(await client.readInbox(), null)
    } catch (e) {
      setError(describe(e))
    } finally {
      setReadingInbox(false)
    }
  }, [client, sync, apply])

  const refreshPrices = useCallback(async () => {
    if (!client) return
    setRefreshingPrices(true)
    try {
      await sync()
      apply(await client.refreshPrices(), null)
    } catch (e) {
      setError(describe(e))
    } finally {
      setRefreshingPrices(false)
    }
  }, [client, sync, apply])

  // Pull on open, and again when the app comes back after a while.
  useEffect(() => {
    if (!client) return
    // Deferred so the first render finishes before syncing starts.
    const first = setTimeout(() => void sync(), 0)
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastSync.current > REFRESH_AFTER_MS) void sync()
    }
    const onOnline = () => void sync()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    return () => {
      clearTimeout(first)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
    }
  }, [client, sync])

  const connect = useCallback(
    async (url: string, token: string) => {
      const bad = validateUrl(url)
      if (bad) throw new SheetError(bad, 'setup')
      const cfg = { url: url.trim(), token: token.trim() }
      if (!/^[0-9a-f]{32,}$/i.test(cfg.token)) throw new SheetError('The secret code is the long code shown by Jhapi > Set up in the sheet.', 'auth')
      const c = new SheetClient(cfg, transport)
      await c.ping()
      const r = await c.pull()
      local.setConfig(cfg)
      setConfig(cfg)
      apply(r, null)
    },
    [local, transport, apply],
  )

  const disconnect = useCallback(() => {
    local.setConfig(null)
    local.setSnapshot(null)
    local.setPending({ transactions: [], review: [], rules: [], names: [], holdings: [], goals: [] })
    setConfig(null)
    setSnapshot(null)
    setPending({ transactions: [], review: [], rules: [], names: [], holdings: [], goals: [] })
    setError(null)
  }, [local])

  const saveTxn = useCallback(
    (t: Txn) => {
      const stamped = { ...t, updatedAt: new Date().toISOString() }
      const p = queueTxn(local.pending(), stamped)
      local.setPending(p)
      setPending(p)
      void sync()
    },
    [local, sync],
  )

  /** Save several transactions at once (bulk edits), with one sync. */
  const saveTxns = useCallback(
    (ts: Txn[]) => {
      if (ts.length === 0) return
      const now = new Date().toISOString()
      let p = local.pending()
      for (const t of ts) p = queueTxn(p, { ...t, updatedAt: now })
      local.setPending(p)
      setPending(p)
      void sync()
    },
    [local, sync],
  )

  /** Show `counterparty` as `showAs` everywhere; an empty `showAs` goes back to the bank's name. */
  const setDisplayName = useCallback(
    (counterparty: string, showAs: string) => {
      const view = snapshot ? withPending(snapshot, local.pending()) : null
      const a: Alias | null = aliasFor(counterparty, showAs, view?.names ?? [], () => crypto.randomUUID())
      if (!a) return
      const p = queueName(local.pending(), { ...a, updatedAt: new Date().toISOString() })
      local.setPending(p)
      setPending(p)
      void sync()
    },
    [local, snapshot, sync],
  )

  const saveHolding = useCallback(
    (h: Holding) => {
      const p = queueHolding(local.pending(), { ...h, updatedAt: new Date().toISOString() })
      local.setPending(p)
      setPending(p)
      void sync()
    },
    [local, sync],
  )

  const saveHoldings = useCallback(
    (hs: Holding[]) => {
      const now = new Date().toISOString()
      const p = hs.reduce((acc, h) => queueHolding(acc, { ...h, updatedAt: now }), local.pending())
      local.setPending(p)
      setPending(p)
      void sync()
    },
    [local, sync],
  )

  const saveGoal = useCallback(
    (g: Goal) => {
      const p = queueGoal(local.pending(), { ...g, updatedAt: new Date().toISOString() })
      local.setPending(p)
      setPending(p)
      void sync()
    },
    [local, sync],
  )

  const saveRule = useCallback(
    (r: Rule, apply = false) => {
      const now = new Date().toISOString()
      let p = queueRule(local.pending(), { ...r, updatedAt: now })
      if (apply && !r.deleted && snapshot) {
        const needle = r.contains.trim().toLowerCase()
        const view = withPending(snapshot, p)
        for (const t of view.transactions) {
          if (t.deleted || t.category === r.category || t.category === 'Transfer') continue
          if (t.counterparty.toLowerCase().includes(needle)) p = queueTxn(p, { ...t, category: r.category, updatedAt: now })
        }
      }
      local.setPending(p)
      setPending(p)
      void sync()
    },
    [local, snapshot, sync],
  )

  const resolveReview = useCallback(
    (id: string, resolved: boolean) => {
      const p = queueReview(local.pending(), { id, resolved, updatedAt: new Date().toISOString() })
      local.setPending(p)
      setPending(p)
      void sync()
    },
    [local, sync],
  )

  const data = useMemo(() => (snapshot ? withPending(snapshot, pending) : null), [snapshot, pending])

  const value: Store = {
    saveGoal,
    refreshPrices,
    refreshingPrices,
    saveRule,
    saveHolding,
    saveHoldings,
    config,
    data,
    pendingCount: pending.transactions.length + pending.review.length + pending.rules.length + pending.names.length + pending.holdings.length + pending.goals.length,
    syncing,
    readingInbox,
    error,
    notice,
    connect,
    disconnect,
    sync,
    readInbox,
    saveTxn,
    saveTxns,
    setDisplayName,
    resolveReview,
    clearNotice: () => setNotice(null),
  }
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

