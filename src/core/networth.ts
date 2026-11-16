/**
 * Net worth on a day: holdings (valued by valueHolding) plus the latest balance each bank account
 * reported by email, minus loans. The script saves one snapshot a day in the "Net worth" tab, and the
 * Home chart reads them. Bundled into the Apps Script, so keep it free of browser and Node APIs.
 */
import type { ISODate } from './dates'
import { summarise, type Holding, type HoldingClass } from './holdings'
import { counts, type Txn } from './records'

export interface Snapshot {
  date: ISODate
  netPaise: number
  /** Assets among holdings (liabilities excluded). */
  holdingsPaise: number
  bankPaise: number
  /** Loans and dues, as a negative number. */
  liabilitiesPaise: number
  byClass: Record<Exclude<HoldingClass, 'liabilities'>, number>
}

/** Latest reported balance of each bank account (cards and wallets are left out). */
export function bankBalances(txns: Txn[]): Map<string, { balancePaise: number; date: ISODate }> {
  const out = new Map<string, { balancePaise: number; date: ISODate; key: string }>()
  for (const t of txns) {
    if (!counts(t) || t.balancePaise === null || !t.account.includes('-bank-')) continue
    const key = t.date + ' ' + (t.time || '00:00:00')
    const cur = out.get(t.account)
    if (!cur || key >= cur.key) out.set(t.account, { balancePaise: t.balancePaise, date: t.date, key })
  }
  return new Map([...out].map(([k, v]) => [k, { balancePaise: v.balancePaise, date: v.date }]))
}

export function netWorthSnapshot(holdings: Holding[], txns: Txn[], date: ISODate): Snapshot {
  const s = summarise(holdings, date)
  let bank = 0
  for (const b of bankBalances(txns).values()) bank += b.balancePaise
  const cls = (c: HoldingClass) => s.byClass.find((g) => g.cls === c)?.totalPaise ?? 0
  return {
    date,
    netPaise: s.netPaise + bank,
    holdingsPaise: s.assetsPaise,
    bankPaise: bank,
    liabilitiesPaise: s.liabilitiesPaise,
    byClass: { retirement: cls('retirement'), market: cls('market'), deposits: cls('deposits'), gold_other: cls('gold_other') },
  }
}

export type Range = '1M' | '3M' | '6M' | '1Y' | 'FY' | 'All'

/** Snapshots inside a range ending today, oldest first. FY starts on 1 April. */
export function inRange(snaps: Snapshot[], range: Range, today: ISODate): Snapshot[] {
  const sorted = [...snaps].sort((a, b) => (a.date < b.date ? -1 : 1))
  if (range === 'All') return sorted
  let from: string
  if (range === 'FY') {
    const y = Number(today.slice(0, 4))
    from = Number(today.slice(5, 7)) >= 4 ? `${y}-04-01` : `${y - 1}-04-01`
  } else {
    const months = { '1M': 1, '3M': 3, '6M': 6, '1Y': 12 }[range]
    const d = new Date(`${today}T00:00:00Z`)
    d.setUTCMonth(d.getUTCMonth() - months)
    from = d.toISOString().slice(0, 10)
  }
  return sorted.filter((s) => s.date >= from && s.date <= today)
}
