import { describe, expect, it } from 'vitest'
import { blankHolding, type Holding } from './holdings'
import { parseAmfiNav, priceKey, priceUpdates } from './prices'

// The shape of AMFI's NAVAll.txt, with made-up schemes and values.
const NAV_FILE = `Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date

Open Ended Schemes(Debt Scheme - Banking and PSU Fund)

Example Mutual Fund

100001;INF000A01AA1;-;Example Flexi Cap Fund - Direct Plan - Growth;87.6543;14-Nov-2026
100002;INF000A01AA2;INF000A01AA3;Example Liquid Fund - Direct - IDCW;1000.0000;15-Nov-2026
100003;INF000A01AA4;-;Example Closed Fund;N.A.;14-Nov-2026
`

const h = (p: Partial<Holding>): Holding => ({ ...blankHolding(p.type ?? 'mf', p.id ?? 'x'), ...p })

describe('AMFI NAV file', () => {
  it('reads scheme lines, skips headings and N.A.', () => {
    const m = parseAmfiNav(NAV_FILE)
    expect([...m.keys()]).toEqual(['100001', '100002'])
    expect(m.get('100001')).toEqual({ pricePaise: 8765, date: '2026-11-14' })
  })
})

describe('price keys', () => {
  it('funds need a numeric AMFI code; stocks get NSE: by default', () => {
    expect(priceKey(h({ type: 'mf', code: '100001' }))).toEqual({ source: 'amfi', key: '100001' })
    expect(priceKey(h({ type: 'mf', code: 'Flexi cap' }))).toBeNull()
    expect(priceKey(h({ type: 'stock', code: 'tcs' }))).toEqual({ source: 'google', key: 'NSE:TCS' })
    expect(priceKey(h({ type: 'etf', code: 'BOM:500325' }))).toEqual({ source: 'google', key: 'BOM:500325' })
    expect(priceKey(h({ type: 'stock', code: '=HYPERLINK("x")' }))).toBeNull()
    expect(priceKey(h({ type: 'ppf', code: '1' }))).toBeNull()
    expect(priceKey(h({ type: 'mf', code: '100001', deleted: true }))).toBeNull()
  })
})

describe('price updates', () => {
  it('only for holdings whose price or date changed', () => {
    const amfi = parseAmfiNav(NAV_FILE)
    const google = new Map([['NSE:TCS', { pricePaise: 412345, date: '2026-11-17' }]])
    const list = [
      h({ id: 'a', type: 'mf', code: '100001' }),
      h({ id: 'b', type: 'mf', code: '100001', pricePaise: 8765, priceDate: '2026-11-14' }),
      h({ id: 'c', type: 'stock', code: 'TCS' }),
      h({ id: 'd', type: 'stock', code: 'NOPE' }),
    ]
    expect(priceUpdates(list, amfi, google)).toEqual([
      { id: 'a', pricePaise: 8765, priceDate: '2026-11-14' },
      { id: 'c', pricePaise: 412345, priceDate: '2026-11-17' },
    ])
  })
})
