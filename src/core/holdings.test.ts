import { describe, expect, it } from 'vitest'
import { blankHolding, summarise, valueHolding, type Holding } from './holdings'

const L = (lakh: number) => Math.round(lakh * 1e7)
const R = (rupees: number) => Math.round(rupees * 100)
const h = (type: Holding['type'], p: Partial<Holding>): Holding => ({ ...blankHolding(type, p.id ?? type), ...p })

describe('valuing holdings', () => {
  it('PPF: balance on 1 April plus a year at 7.1%', () => {
    const v = valueHolding(h('ppf', { investedPaise: L(1), startDate: '2025-04-01', ratePct: 7.1 }), '2026-03-31')
    expect(v).toMatchObject({ method: 'calc', valuePaise: R(107100) })
  })
  it('EPF part way through the year shows accrued interest, and contributions add up', () => {
    const v = valueHolding(h('epf', { investedPaise: L(1), startDate: '2026-04-01', ratePct: 8.25 }), '2026-09-30')
    expect(v.valuePaise).toBe(R(104125))
    const withMonthly = valueHolding(h('epf', { investedPaise: L(1), startDate: '2026-04-01', ratePct: 8.25, monthlyPaise: R(10000) }), '2026-09-30')
    expect(withMonthly.valuePaise).toBeGreaterThan(R(104125 + 50000))
  })
  it('FD and payout schemes', () => {
    const fd = valueHolding(h('fd', { investedPaise: L(1), ratePct: 7, startDate: '2025-01-01', maturityDate: '2026-01-01' }), '2026-06-01')
    expect(fd).toMatchObject({ valuePaise: R(107185.9), detail: 'Matured: move the money or close this' })
    expect(valueHolding(h('scss', { investedPaise: L(15), ratePct: 8.2, startDate: '2025-01-01', maturityDate: '2030-01-01' }), '2026-01-01').valuePaise).toBe(L(15))
  })
  it('RD from installment and months', () => {
    expect(Math.round(valueHolding(h('rd', { monthlyPaise: R(1000), ratePct: 7, startDate: '2025-01-01', tenureMonths: 12 }), '2026-01-01').valuePaise / 100)).toBe(12464)
  })
  it('market holdings from units × price, else the typed value', () => {
    expect(valueHolding(h('mf', { units: '1234.567', pricePaise: R(156.23), priceDate: '2026-11-14' }), '2026-11-17')).toMatchObject({ valuePaise: 19287640, method: 'price', asOf: '2026-11-14' })
    expect(valueHolding(h('stock', { valuePaise: R(5000) }), '2026-11-17')).toMatchObject({ valuePaise: R(5000), method: 'manual' })
    expect(valueHolding(h('stock', {}), '2026-11-17').missing).toBeTruthy()
    expect(valueHolding(h('mf', { units: 'abc', pricePaise: 100 }), '2026-11-17').missing).toMatch(/Units/)
  })
  it('loans count as negative, from the EMI schedule or the owner\'s figure', () => {
    const v = valueHolding(h('home_loan', { investedPaise: L(50), ratePct: 8.5, tenureMonths: 240, startDate: '2022-05-05' }), '2026-11-17')
    expect(v.valuePaise).toBeLessThan(-L(40))
    expect(v.valuePaise).toBeGreaterThan(-L(50))
    expect(v.detail).toMatch(/185 EMIs left, next 2026-12-05/)
    expect(valueHolding(h('home_loan', { valuePaise: L(40) }), '2026-11-17').valuePaise).toBe(-L(40))
  })
  it('manual holdings need a value', () => {
    expect(valueHolding(h('property', { valuePaise: L(60), valueDate: '2026-06-01' }), '2026-11-17')).toMatchObject({ valuePaise: L(60), asOf: '2026-06-01' })
    expect(valueHolding(h('gold', {}), '2026-11-17').missing).toBe('Enter the current value')
  })
})

describe('portfolio summary', () => {
  it('groups by class, subtracts liabilities, skips deleted', () => {
    const s = summarise(
      [
        h('ppf', { id: 'a', investedPaise: L(1), startDate: '2025-04-01', ratePct: 7.1 }),
        h('property', { id: 'b', valuePaise: L(60) }),
        h('home_loan', { id: 'c', valuePaise: L(40) }),
        h('gold', { id: 'd', valuePaise: L(5), deleted: true }),
      ],
      '2026-03-31',
    )
    expect(s.byClass.map((g) => g.cls)).toEqual(['retirement', 'gold_other', 'liabilities'])
    expect(s.assetsPaise).toBe(R(107100) + L(60))
    expect(s.liabilitiesPaise).toBe(-L(40))
    expect(s.netPaise).toBe(R(107100) + L(20))
  })
})
