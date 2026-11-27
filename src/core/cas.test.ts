import { describe, expect, it } from 'vitest'
import { addUnits, decimalText, fundHolding, lastSip, matchFunds, parseCas, shareHolding, soldOut } from './cas'
import { blankHolding, valueHolding, type Holding } from './holdings'

// The shape of a CAMS + KFintech detailed CAS, as pdf.js gives it line by line. Names and numbers are made up.
const DETAILED = `Consolidated Account Statement
01-Jan-2020 To 25-Nov-2026
Example Mutual Fund
Folio No: 1234567 / 89 PAN: ABCDE1234F KYC: OK PAN: OK
X123-Example Flexi Cap Fund - Direct Plan - Growth (Non-Demat) - ISIN: INF000A01AB1(Advisor: DIRECT) Registrar : CAMS
Nominee 1: Someone
Opening Unit Balance: 100.000
05-Nov-2026 Purchase - Systematic 5,000.00 50.000 100.0000 150.000
05-Nov-2026 *** Stamp Duty *** 0.25
Closing Unit Balance: 150.000 NAV on 25-Nov-2026: INR 102.3456 Total Cost Value: 14,500.00 Market Value on 25-Nov-2026: INR 15,351.84
Folio No: 7654321 / 00 PAN: ABCDE1234F KYC: OK PAN: OK
X123-Example Flexi Cap Fund - Direct Plan - Growth (Non-Demat) - ISIN: INF000A01AB1(Advisor: DIRECT) Registrar : CAMS
Closing Unit Balance: 10.500 NAV on 25-Nov-2026: INR 102.3456 Total Cost Value: 1,000.00 Market Value on 25-Nov-2026: INR 1,074.63
Other Mutual Fund
Folio No: 99887766 PAN: ABCDE1234F KYC: OK PAN: OK
Y77-Other Large and Mid Cap Fund - Direct Plan -
ISIN: INF000B02CD2(Advisor: DIRECT) Registrar : KFINTECH
Closing Unit Balance: 0.000 NAV on 24-Nov-2026: INR 20.1000 Total Cost Value: 0.00 Market Value on 24-Nov-2026: INR 0.00
Folio No: 11223344 PAN: ABCDE1234F
Z1-Broken Fund - ISIN: INF000C03EF3 Registrar : CAMS
Page 3 of 9`

// The shape of a depository (NSDL/CDSL) CAS: one row per holding.
const ROWS = `CONSOLIDATED ACCOUNT STATEMENT
Statement for the period from 01-10-2026 to 31-10-2026
HOLDING STATEMENT AS ON 31-10-2026
ISIN Security Current Bal Free Bal Market Price Value
INE000A01011 EXAMPLE INDUSTRIES LIMITED 12.000 12.000 1,500.50 18,006.00
INE000B01022 SAMPLE BANK LTD 5.000 5.000 800.00 4,000.00
INSTITUTIONS AND INVESTORS 1.00 2.00 3.00
MUTUAL FUND UNITS HELD AS ON 31-10-2026
Scheme Name ISIN Folio No. Closing Bal (Units) NAV (₹) Total Value (₹)
Example Index Fund Direct Growth INF000D04GH4 5566778 25,000.00 321.123 80.0000 25,689.84
Example Gold ETF INF000E05IJ5 1.000 2.00 999.00`

describe('CAS: numbers', () => {
  it('keeps units exact', () => {
    expect(decimalText('1,23,456.780')).toBe('123456.78')
    expect(decimalText('0.000')).toBe('0')
    expect(addUnits('150', '10.5')).toBe('160.5')
    expect(addUnits('0.001', '0.999')).toBe('1')
    expect(soldOut('0')).toBe(true)
    expect(soldOut('0.001')).toBe(false)
  })
})

describe('CAS: detailed statement', () => {
  const s = parseCas(DETAILED.split('\n'))

  it('reads each fund once, adding folios of the same scheme', () => {
    expect(s.kind).toBe('detailed')
    expect(s.asOf).toBe('2026-11-25')
    expect(s.funds.map((f) => f.isin)).toEqual(['INF000A01AB1', 'INF000B02CD2'])
    const f = s.funds[0]
    expect(f.name).toBe('Example Flexi Cap Fund - Direct Plan - Growth')
    expect(f.amc).toBe('Example Mutual Fund')
    expect(f.folios).toEqual(['1234567/89', '7654321/00'])
    expect(f.units).toBe('160.5')
    expect(f.navPaise).toBe(10235)
    expect(f.navDate).toBe('2026-11-25')
    expect(f.costPaise).toBe(1_550_000)
    expect(f.valuePaise).toBe(1_642_647)
    expect(f.sipPaise).toBe(500_000) // the 5 Nov instalment; the second folio has no SIP
  })

  it('finds the ongoing SIP, rounded to the rupee, and ignores old ones and transfers', () => {
    const block = [
      '05-Sep-2026 SIP Purchase-BSE - Instalment No 10 - 2,999.85 30.000 99.9950 120.000',
      '05-Oct-2026 SIP Purchase-BSE - Instalment No 11 - 4,999.75 49.998 100.0000 169.998',
      '10-Oct-2026 Systematic Transfer In 10,000.00 99.000 101.0000 268.998',
      '12-Oct-2026 Systematic Withdrawal (1,000.00) (9.000) 111.0000 259.998',
    ].join('\n')
    expect(lastSip(block, '2026-11-10')).toBe(500_000)
    expect(lastSip(block, '2027-01-25')).toBeNull() // last instalment more than 45 days before the statement
    expect(lastSip('05-Nov-2026 Purchase 5,000.00 50.000 100.0000 150.000', '2026-11-25')).toBeNull() // a lump sum
  })

  it('joins a name the PDF wrapped, and marks a sold-out folio', () => {
    const g = s.funds[1]
    expect(g.name).toBe('Other Large and Mid Cap Fund - Direct Plan')
    expect(g.amc).toBe('Other Mutual Fund')
    expect(soldOut(g.units)).toBe(true)
  })

  it('lists a fund it could not read instead of guessing', () => {
    expect(s.unread).toEqual(['Broken Fund'])
  })
})

describe('CAS: row statement (NSDL/CDSL)', () => {
  const s = parseCas(ROWS.split('\n'))

  it('takes rows whose units × price match the value', () => {
    expect(s.kind).toBe('rows')
    expect(s.asOf).toBe('2026-10-31')
    expect(s.shares).toEqual([
      { isin: 'INE000A01011', name: 'EXAMPLE INDUSTRIES LIMITED', units: '12', pricePaise: 150050, valuePaise: 1_800_600 },
      { isin: 'INE000B01022', name: 'SAMPLE BANK LTD', units: '5', pricePaise: 80000, valuePaise: 400_000 },
    ])
    expect(s.funds).toHaveLength(1)
    expect(s.funds[0]).toMatchObject({ isin: 'INF000D04GH4', name: 'Example Index Fund Direct Growth', units: '321.123', navPaise: 8000, navDate: '2026-10-31', costPaise: 2_500_000, valuePaise: 2_568_984 })
  })

  it('drops a row whose numbers do not agree', () => {
    expect(s.unread).toEqual(['INF000E05IJ5'])
  })
})

describe('CAS: into holdings', () => {
  const s = parseCas(DETAILED.split('\n'))
  const mine = (p: Partial<Holding>): Holding => ({ ...blankHolding('mf', p.id ?? 'h'), ...p })

  it('matches by ISIN first, then by name, each holding once', () => {
    const hs = [mine({ id: 'a', name: 'other large and mid cap fund direct plan' }), mine({ id: 'b', code: 'inf000a01ab1', name: 'My flexi' }), mine({ id: 'c', code: 'INF000A01AB1', deleted: true })]
    expect(matchFunds(s.funds, hs)).toEqual(new Map([['INF000A01AB1', 'b'], ['INF000B02CD2', 'a']]))
  })

  it('a new fund gets the ISIN, units, NAV, cost and folios, and is valued from them', () => {
    const h = fundHolding(s.funds[0], null, () => 'new1')
    expect(h.monthlyPaise).toBe(500_000)
    expect(h).toMatchObject({ id: 'new1', type: 'mf', name: 'Example Flexi Cap Fund - Direct Plan - Growth', institution: 'Example Mutual Fund', code: 'INF000A01AB1', units: '160.5', pricePaise: 10235, priceDate: '2026-11-25', investedPaise: 1_550_000, notes: 'Folio 1234567/89, 7654321/00 · from CAS' })
    expect(valueHolding(h, '2026-11-26').valuePaise).toBe(1_642_718)
  })

  it('an existing fund keeps its name, notes and a newer price', () => {
    const base = mine({ id: 'b', name: 'My flexi', code: '100001', notes: 'SIP 5k', units: '100', pricePaise: 10400, priceDate: '2026-11-26', monthlyPaise: 300_000 })
    const h = fundHolding(s.funds[0], base, () => 'unused')
    expect(h.monthlyPaise).toBe(500_000) // the statement's SIP replaces the old figure
    expect(fundHolding({ ...s.funds[0], sipPaise: null }, base, () => 'x').monthlyPaise).toBe(300_000)
    expect(fundHolding(s.funds[1], { ...base, monthlyPaise: 300_000 }, () => 'x').monthlyPaise).toBeNull() // sold out
    expect(h).toMatchObject({ id: 'b', name: 'My flexi', notes: 'SIP 5k', code: 'INF000A01AB1', units: '160.5', pricePaise: 10400, priceDate: '2026-11-26', investedPaise: 1_550_000 })
  })

  it('a share becomes a stock with the symbol the owner gives', () => {
    const r = parseCas(ROWS.split('\n'))
    const h = shareHolding(r.shares[0], 'nse:exind', null, r.asOf, () => 's1')
    expect(h).toMatchObject({ id: 's1', type: 'stock', name: 'EXAMPLE INDUSTRIES LIMITED', code: 'NSE:EXIND', units: '12', pricePaise: 150050, priceDate: '2026-10-31', notes: 'ISIN INE000A01011 · from CAS' })
  })
})
