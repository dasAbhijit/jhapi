/**
 * What the app keeps on this device: the sheet connection, the last copy of the sheet (so the app
 * opens instantly and works offline), and changes not yet sent to the sheet.
 *
 * Kept in localStorage for now. Encryption on the device comes later (DESIGN.md, section 4).
 * Every access is wrapped: Safari private browsing and cleared site data must not crash the app.
 */
import type { Holding } from '../core/holdings'
import type { Snapshot as NetWorthPoint } from '../core/networth'
import type { Goal } from '../core/goalPlan'
import type { ReviewItem, Rule, Statement, Txn } from '../core/records'
import type { SheetConfig } from './sheetClient'

export interface Snapshot {
  pulledAt: string
  version: number
  lastInboxRun: string
  transactions: Txn[]
  statements: Statement[]
  review: ReviewItem[]
  rules: Rule[]
  holdings: Holding[]
  netWorth: NetWorthPoint[]
  goals: Goal[]
  problems: string[]
}

export interface Pending {
  transactions: Txn[]
  review: Pick<ReviewItem, 'id' | 'resolved' | 'updatedAt'>[]
  rules: Rule[]
  holdings: Holding[]
  goals: Goal[]
}

export interface KV {
  get(key: string): string | null
  set(key: string, value: string): void
  remove(key: string): void
}

export const browserKV: KV = {
  get: (k) => {
    try {
      return localStorage.getItem(k)
    } catch {
      return null
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v)
    } catch {
      /* storage full or blocked: the sheet still has everything */
    }
  },
  remove: (k) => {
    try {
      localStorage.removeItem(k)
    } catch {
      /* ignore */
    }
  },
}

export function memoryKV(): KV {
  const m = new Map<string, string>()
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) }
}

const KEYS = { config: 'jhapi.sheet', snapshot: 'jhapi.snapshot', pending: 'jhapi.pending', device: 'jhapi.device' }

function read<T>(kv: KV, key: string): T | null {
  const raw = kv.get(key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export class LocalStore {
  private readonly kv: KV
  constructor(kv: KV = browserKV) {
    this.kv = kv
  }

  config(): SheetConfig | null {
    const c = read<SheetConfig>(this.kv, KEYS.config)
    return c && typeof c.url === 'string' && typeof c.token === 'string' ? c : null
  }
  setConfig(c: SheetConfig | null) {
    if (c) this.kv.set(KEYS.config, JSON.stringify(c))
    else this.kv.remove(KEYS.config)
  }

  snapshot(): Snapshot | null {
    const s = read<Snapshot>(this.kv, KEYS.snapshot)
    return s && Array.isArray(s.transactions) ? { ...s, rules: s.rules ?? [], holdings: s.holdings ?? [], netWorth: s.netWorth ?? [], goals: s.goals ?? [] } : null
  }
  setSnapshot(s: Snapshot | null) {
    if (s) this.kv.set(KEYS.snapshot, JSON.stringify(s))
    else this.kv.remove(KEYS.snapshot)
  }

  pending(): Pending {
    const p = read<Pending>(this.kv, KEYS.pending)
    return { transactions: p?.transactions ?? [], review: p?.review ?? [], rules: p?.rules ?? [], holdings: p?.holdings ?? [], goals: p?.goals ?? [] }
  }
  setPending(p: Pending) {
    if (p.transactions.length === 0 && p.review.length === 0 && p.rules.length === 0 && p.holdings.length === 0 && p.goals.length === 0) this.kv.remove(KEYS.pending)
    else this.kv.set(KEYS.pending, JSON.stringify(p))
  }

  /** A name for this device in the sheet's Log, e.g. "iPhone Safari". */
  deviceName(): string {
    const saved = this.kv.get(KEYS.device)
    if (saved) return saved
    const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent
    const name = /iPad|Macintosh.*Mobile/.test(ua) ? 'iPad' : /iPhone/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : 'Browser'
    this.kv.set(KEYS.device, name)
    return name
  }
}

/** Put a changed record into the queue, replacing any earlier unsent change to the same record. */
export function queueTxn(p: Pending, t: Txn): Pending {
  return { ...p, transactions: [...p.transactions.filter((x) => x.id !== t.id), t] }
}

export function queueGoal(p: Pending, g: Goal): Pending {
  return { ...p, goals: [...p.goals.filter((x) => x.id !== g.id), g] }
}

export function queueHolding(p: Pending, h: Holding): Pending {
  return { ...p, holdings: [...p.holdings.filter((x) => x.id !== h.id), h] }
}

export function queueRule(p: Pending, r: Rule): Pending {
  return { ...p, rules: [...p.rules.filter((x) => x.id !== r.id), r] }
}

export function queueReview(p: Pending, r: Pick<ReviewItem, 'id' | 'resolved' | 'updatedAt'>): Pending {
  return { ...p, review: [...p.review.filter((x) => x.id !== r.id), r] }
}

/** The snapshot with unsent local changes laid on top, which is what the screens show. */
export function withPending(s: Snapshot, p: Pending): Snapshot {
  const ids = new Set(p.transactions.map((t) => t.id))
  const resolved = new Map(p.review.map((r) => [r.id, r.resolved]))
  const ruleIds = new Set(p.rules.map((r) => r.id))
  const holdingIds = new Set(p.holdings.map((h) => h.id))
  const goalIds = new Set(p.goals.map((g) => g.id))
  return {
    ...s,
    goals: [...s.goals.filter((g) => !goalIds.has(g.id)), ...p.goals],
    holdings: [...s.holdings.filter((h) => !holdingIds.has(h.id)), ...p.holdings],
    rules: [...s.rules.filter((r) => !ruleIds.has(r.id)), ...p.rules],
    transactions: [...s.transactions.filter((t) => !ids.has(t.id)), ...p.transactions],
    review: s.review.map((r) => (resolved.has(r.id) ? { ...r, resolved: resolved.get(r.id)! } : r)),
  }
}
