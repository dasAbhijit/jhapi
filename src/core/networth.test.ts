import { describe, expect, it } from 'vitest'
import { blankHolding, type Holding } from './holdings'
import { bankBalances, inRange, netWorthSnapshot, type Snapshot } from './networth'
import type { Txn } from './records'

const L = (lakh: number) => Math.round(lakh * 1e7)
const tx = (p: Partial<Txn>): Txn => ({
  id: 'x', date: '2026-11-16', time: '', account: 'axis-bank-1111', direction: 'debit', amountPaise: 100, counterparty: '', category: 'Other',
  channel: 'upi', reference: '', balancePaise: null, status: 'verified', source: 'email', note: '', emailId: '', template: '',
  updatedAt: '', deleted: false, ...p,
})
const h = (p: Partial<Holding>): Holding => ({ ...blankHolding(p.type ?? 'property', p.id ?? 'h'), ...p })

describe('bank balances', () => {
  it('takes the latest reported balance per bank account; ignores cards, receipts and rows without one', () => {
    const b = bankBalances([
      tx({ id: '1', date: '2026-11-15', balancePaise: 500 }),
      tx({ id: '2', date: '2026-11-16', time: '09:00:00', balancePaise: 700 }),
      tx({ id: '3', date: '2026-11-16', time: '08:00:00', balancePaise: 600 }),
      tx({ id: '4', account: 'icici-credit_card-4444', balancePaise: 999 }),
      tx({ id: '5', account: 'dbs-bank-6666', balancePaise: 50, status: 'receipt' }),
      tx({ id: '6', account: 'sbi-bank-2222', balancePaise: null }),
    ])
    expect([...b.entries()]).toEqual([['axis-bank-1111', { balancePaise: 700, date: '2026-11-16' }]])
  })
})

describe('net worth snapshot', () => {
  it('adds holdings and bank balances, subtracts loans, splits by class', () => {
    const s = netWorthSnapshot(
      [h({ id: 'p', valuePaise: L(60) }), h({ id: 'l', type: 'home_loan', valuePaise: L(40) }), h({ id: 'g', type: 'gold', valuePaise: L(2) })],
      [tx({ balancePaise: L(3) })],
      '2026-11-17',
    )
    expect(s).toEqual({
      date: '2026-11-17', netPaise: L(25), holdingsPaise: L(62), bankPaise: L(3), liabilitiesPaise: -L(40),
      byClass: { retirement: 0, market: 0, deposits: 0, gold_other: L(62) },
    })
  })
})

describe('ranges', () => {
  const snaps = ['2025-03-31', '2025-04-01', '2026-04-01', '2026-08-17', '2026-10-17', '2026-11-16'].map(
    (date) => ({ date, netPaise: 0 }) as Snapshot,
  )
  it('cuts by months, financial year or all', () => {
    expect(inRange(snaps, '1M', '2026-11-17').map((s) => s.date)).toEqual(['2026-10-17', '2026-11-16'])
    expect(inRange(snaps, '3M', '2026-11-17').map((s) => s.date)).toEqual(['2026-08-17', '2026-10-17', '2026-11-16'])
    expect(inRange(snaps, 'FY', '2026-11-17')[0].date).toBe('2026-04-01')
    expect(inRange(snaps, 'FY', '2026-03-01').map((s) => s.date)).toEqual(['2025-04-01'])
    expect(inRange(snaps, 'All', '2026-11-17')).toHaveLength(6)
  })
})
