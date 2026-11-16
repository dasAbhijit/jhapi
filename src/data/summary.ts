/** Numbers for the Home screen, worked out from the transactions. Pure and tested. */
import { counts, type Statement, type Txn } from '../core/records'
import type { ISODate } from '../core/dates'

/** Categories that move money between the owner's own accounts: not spending, not income. */
const NOT_SPENDING = new Set(['Transfer', 'Investments', 'Refund'])

export interface MonthSummary {
  month: string // YYYY-MM
  spentPaise: number
  receivedPaise: number
  byCategory: { category: string; paise: number }[]
}

export function monthSummary(txns: Txn[], month: string): MonthSummary {
  let spent = 0
  let received = 0
  const cat = new Map<string, number>()
  for (const t of txns) {
    if (!counts(t) || !t.date.startsWith(month) || NOT_SPENDING.has(t.category)) continue
    if (t.direction === 'debit') {
      spent += t.amountPaise
      cat.set(t.category, (cat.get(t.category) ?? 0) + t.amountPaise)
    } else {
      received += t.amountPaise
    }
  }
  return {
    month,
    spentPaise: spent,
    receivedPaise: received,
    byCategory: [...cat.entries()].map(([category, paise]) => ({ category, paise })).sort((a, b) => b.paise - a.paise),
  }
}

export interface AccountBalance {
  account: string
  /** Latest balance the bank reported, and when; null if no email gave one. */
  balancePaise: number | null
  asOf: ISODate | null
  lastActivity: ISODate
  count: number
}

export function accounts(txns: Txn[]): AccountBalance[] {
  const map = new Map<string, AccountBalance>()
  const sorted = [...txns].filter((t) => counts(t) && t.account).sort((a, b) => (a.date + a.time < b.date + b.time ? -1 : 1))
  for (const t of sorted) {
    const a = map.get(t.account) ?? { account: t.account, balancePaise: null, asOf: null, lastActivity: t.date, count: 0 }
    a.count++
    a.lastActivity = t.date
    if (t.balancePaise !== null) {
      a.balancePaise = t.balancePaise
      a.asOf = t.date
    }
    map.set(t.account, a)
  }
  return [...map.values()].sort((a, b) => (a.lastActivity < b.lastActivity ? 1 : -1))
}

/** Card bills not yet due, soonest first; only the latest statement per card. */
export function upcomingDues(statements: Statement[], today: ISODate): Statement[] {
  const latest = new Map<string, Statement>()
  for (const s of statements) {
    const cur = latest.get(s.account)
    if (!cur || s.dueDate > cur.dueDate) latest.set(s.account, s)
  }
  return [...latest.values()].filter((s) => s.dueDate >= today).sort((a, b) => (a.dueDate < b.dueDate ? -1 : 1))
}

/** Newest first, then grouped by date for the list. */
export function groupByDate(txns: Txn[]): { date: ISODate; items: Txn[] }[] {
  const sorted = [...txns].sort((a, b) => (a.date + a.time < b.date + b.time ? 1 : -1))
  const groups: { date: ISODate; items: Txn[] }[] = []
  for (const t of sorted) {
    const g = groups.at(-1)
    if (g && g.date === t.date) g.items.push(t)
    else groups.push({ date: t.date, items: [t] })
  }
  return groups
}

export function todayIST(now = Date.now()): ISODate {
  return new Date(now + 5.5 * 3600_000).toISOString().slice(0, 10)
}
