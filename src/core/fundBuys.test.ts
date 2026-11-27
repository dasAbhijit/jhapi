import { describe, expect, it } from 'vitest'
import { addSigned, applyBuys, fundKey, matchBuy, parseFundEmail, type FundBuy } from './fundBuys'
import { CDSL, COIN, KFIN } from './fundBuys.fixture'
import { blankHolding, type Holding } from './holdings'

const fund = (p: Partial<Holding>): Holding => ({ ...blankHolding('mf', p.id ?? 'h'), units: '100', ...p })
const buy = (p: Partial<FundBuy>): FundBuy => ({
  id: 'e#0', date: '2026-11-04', fund: '', folio: '', isin: '', units: '1', navPaise: null, amountPaise: null, source: 'coin', holdingId: '', status: '', note: '', updatedAt: '', ...p,
})

describe('purchase emails', () => {
  it('Coin: every fund in the allotment, dated the NAV day (the day before the report)', () => {
    expect(parseFundEmail(COIN)).toEqual([
      { date: '2026-11-04', fund: 'EXAMPLE VALUE INDEX FUND DIRECT PLAN GROWTH', folio: '910000000001', isin: '', units: '528.591', navPaise: 2648, amountPaise: 1_399_930, source: 'coin' },
      { date: '2026-11-04', fund: 'SAMPLE CONTRA FUND - DIRECT PLAN - GROWTH', folio: '19000001', isin: '', units: '118.713', navPaise: 17689, amountPaise: 2_099_895, source: 'coin' },
    ])
  })

  it('Coin: the same text with the table flattened, as the script sees HTML-only mail', () => {
    const flat = { ...COIN, text: COIN.text.replace(/[|#-]{2,}/g, ' ').replace(/\|/g, ' ').replace(/\n/g, ' ') }
    expect(parseFundEmail(flat).map((b) => b.units)).toEqual(['528.591', '118.713'])
  })

  it('KFintech: the purchase, with the folio from the subject', () => {
    expect(parseFundEmail(KFIN)).toEqual([
      { date: '2026-11-04', fund: 'Example Value Index Fund - Direct Growth', folio: '910000000001', isin: '', units: '528.591', navPaise: 2648, amountPaise: 1_399_930, source: 'kfintech' },
    ])
  })

  it('CDSL: fund credits and debits by ISIN; shares are left out', () => {
    expect(parseFundEmail(CDSL)).toEqual([
      { date: '2026-11-04', fund: 'EXAMPLE MF-EXAMPLE VALUE INDEX FUND-DIRECT-GROWTH', folio: '', isin: 'INF000X01011', units: '528.591', navPaise: null, amountPaise: null, source: 'cdsl' },
      { date: '2026-11-04', fund: 'SAMPLE MF-SAMPLE LIQUID FUND', folio: '', isin: 'INF000Y02022', units: '-10.5', navPaise: null, amountPaise: null, source: 'cdsl' },
    ])
  })

  it('writes units without trailing zeros, so emails agree', () => {
    const c = { ...COIN, text: COIN.text.replace('118.713 units', '1,029.360 units') }
    expect(parseFundEmail(c)[1].units).toBe('1029.36')
  })

  it('ignores other senders and other subjects', () => {
    expect(parseFundEmail({ ...COIN, from: 'someone@example.com' })).toEqual([])
    expect(parseFundEmail({ ...KFIN, subject: 'Example MF - Account Statement' })).toEqual([])
    expect(parseFundEmail({ ...COIN, text: 'Order update: your order is pending' })).toEqual([])
  })
})

describe('units arithmetic', () => {
  it('adds and subtracts exactly', () => {
    expect(addSigned('150.5', '-0.25')).toBe('150.25')
    expect(addSigned('100', '528.591')).toBe('628.591')
    expect(addSigned('10.5', '-10.5')).toBe('0')
    expect(addSigned('1', '-2.5')).toBe('-1.5')
  })
})

describe('matching a purchase to a fund', () => {
  const byIsin = fund({ id: 'a', name: 'Anything', code: 'INF000X01011' })
  const byFolio = fund({ id: 'b', name: 'Contra', notes: 'Folio 19000001/22 · from CAS' })
  const byName = fund({ id: 'c', name: 'Example Value Index Fund - Direct Plan - Growth' })

  it('by ISIN, then folio, then name', () => {
    expect(matchBuy({ isin: 'INF000X01011', folio: '', fund: '' }, [byIsin, byFolio, byName])?.id).toBe('a')
    expect(matchBuy({ isin: '', folio: '19000001', fund: 'whatever' }, [byIsin, byFolio, byName])?.id).toBe('b')
    expect(matchBuy({ isin: '', folio: '1900000', fund: 'x' }, [byFolio])).toBeNull() // a folio is matched whole
    expect(matchBuy({ isin: '', folio: '', fund: 'EXAMPLE VALUE INDEX FUND DIRECT PLAN GROWTH' }, [byIsin, byFolio, byName])?.id).toBe('c')
    expect(fundKey('Example Value Index Fund - Direct Growth')).toBe(fundKey('EXAMPLE VALUE INDEX FUND DIRECT PLAN GROWTH'))
  })

  it('never a deleted holding, and not when two funds fit', () => {
    expect(matchBuy({ isin: 'INF000X01011', folio: '', fund: '' }, [{ ...byIsin, deleted: true }])).toBeNull()
    expect(matchBuy({ isin: '', folio: '', fund: byName.name }, [byName, { ...byName, id: 'd' }])).toBeNull()
  })
})

describe('adding purchases to holdings', () => {
  it('adds a purchase once, whichever emails it came in', () => {
    const h = fund({ id: 'h', name: 'Example Value Index Fund - Direct Plan - Growth', code: 'INF000X01011', notes: 'Folio 910000000001 · from CAS', investedPaise: 100_000_00 })
    const buys = [
      buy({ id: 'cdsl#0', source: 'cdsl', isin: 'INF000X01011', units: '528.591', date: '2026-11-04' }),
      buy({ id: 'kfin#0', source: 'kfintech', folio: '910000000001', units: '528.591', amountPaise: 1_399_930, date: '2026-11-04' }),
      buy({ id: 'coin#0', source: 'coin', folio: '910000000001', units: '528.591', amountPaise: 1_399_930, date: '2026-11-04' }),
    ]
    const r = applyBuys(buys, [h], 'NOW')
    expect(r.buys.map((b) => b.status)).toEqual(['duplicate', 'duplicate', 'added'])
    expect(r.buys[2].holdingId).toBe('h')
    expect(r.changed).toHaveLength(1)
    expect(r.changed[0]).toMatchObject({ units: '628.591', investedPaise: 100_000_00 + 1_399_930, updatedAt: 'NOW' })
    // Running again changes nothing.
    expect(applyBuys(r.buys, r.changed, 'LATER').changed).toEqual([])
  })

  it('a purchase already in the units (CAS or hand edit) is not added again; a later one is', () => {
    const h = fund({ id: 'h', code: 'INF000X01011', unitsDate: '2026-11-04' })
    const r = applyBuys([buy({ isin: 'INF000X01011', units: '5', date: '2026-11-04' }), buy({ id: 'e2#0', isin: 'INF000X01011', units: '7', date: '2026-12-04' })], [h], 'NOW')
    expect(r.buys.map((b) => b.status)).toEqual(['in units already', 'added'])
    expect(r.changed[0].units).toBe('107')
  })

  it('a sale takes units off; an unmatched purchase waits and is added once the fund exists', () => {
    const h = fund({ id: 'h', code: 'INF000Y02022', units: '20' })
    const sold = applyBuys([buy({ source: 'cdsl', isin: 'INF000Y02022', units: '-10.5' })], [h], 'NOW')
    expect(sold.changed[0].units).toBe('9.5')

    const waiting = applyBuys([buy({ fund: 'New Fund Direct Growth', units: '3' })], [h], 'NOW')
    expect(waiting.buys[0]).toMatchObject({ status: 'not matched' })
    const later = applyBuys(waiting.buys, [h, fund({ id: 'n', name: 'New Fund - Direct Plan - Growth', units: '0' })], 'LATER')
    expect(later.buys[0]).toMatchObject({ status: 'added', holdingId: 'n' })
    expect(later.changed[0].units).toBe('3')
  })

  it('does not add to a fund without units, or sell more than it holds', () => {
    const r = applyBuys([buy({ isin: 'INF000X01011', units: '5' }), buy({ id: 'x#1', isin: 'INF000Y02022', units: '-50', date: '2026-11-20' })], [fund({ code: 'INF000X01011', units: '' }), fund({ id: 'y', code: 'INF000Y02022', units: '20' })], 'NOW')
    expect(r.buys.map((b) => b.status)).toEqual(['not matched', 'not matched'])
    expect(r.buys[0].note).toMatch(/no units/)
    expect(r.buys[1].note).toMatch(/more units sold/)
    expect(r.changed).toEqual([])
  })
})
