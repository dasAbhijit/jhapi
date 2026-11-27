import { describe, expect, it } from 'vitest'
import { addMonths, daysBetween, financialYear, monthsBetween } from './dates'
import { depositValue, payoutPerPeriod, recurringDepositValue } from './deposits'
import { futureCost, planGoal, sipFutureValue, sipNeeded } from './goals'
import { emi, loanSchedule, loanStatus } from './loans'
import { gain, marketValue } from './market'
import { formatRupees, formatShort } from './money'
import { annualCreditValue } from './savings'

const L = (lakh: number) => Math.round(lakh * 1e5 * 100) // lakh rupees → paise
const R = (rupees: number) => Math.round(rupees * 100) // rupees → paise
const rupees = (paise: number) => Math.round(paise / 100)

describe('dates', () => {
  it('adds months, clamping to the end of shorter months', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29')
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15')
    expect(addMonths('2026-03-15', -3)).toBe('2025-12-15')
  })
  it('knows the Indian financial year', () => {
    expect(financialYear('2026-03-31').label).toBe('FY 2025–26')
    expect(financialYear('2026-04-01')).toMatchObject({ startYear: 2026, start: '2026-04-01', end: '2027-03-31', label: 'FY 2026–27' })
    expect(financialYear('2099-12-01').label).toBe('FY 2099–00')
  })
  it('counts days and months', () => {
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365)
    expect(daysBetween('2028-01-01', '2029-01-01')).toBe(366)
    expect(monthsBetween('2026-11-30', '2027-02-01')).toBe(3)
  })
  it('rejects impossible dates', () => {
    expect(() => addMonths('2026-02-30', 1)).toThrow()
  })
})

describe('money short forms', () => {
  it('shows lakh and crore like the design', () => {
    expect(formatShort(R(4477119))).toBe('₹44.8L')
    expect(formatShort(R(64000000))).toBe('₹6.4 Cr')
    expect(formatShort(R(20000000))).toBe('₹2 Cr')
    expect(formatShort(R(9996000))).toBe('₹1 Cr')
    expect(formatShort(R(38420))).toBe('₹38,420')
    expect(formatShort(-L(41.85))).toBe('−₹41.9L')
  })
  it('shows whole rupees', () => {
    expect(formatRupees(R(-100000))).toBe('−₹1,00,000')
    expect(formatRupees(4_820_49)).toBe('₹4,820')
  })
})

describe('EPF, PPF and SSY (interest credited on 31 March)', () => {
  it('EPF: a year on an opening balance', () => {
    const r = annualCreditValue({
      scheme: 'epf', openingBalancePaise: L(1), openingDate: '2025-04-01', flows: [], ratesByFy: { 2025: 8.25 }, asOf: '2026-03-31',
    })
    expect(r.balancePaise).toBe(R(108250))
    expect(r.accruedPaise).toBe(0)
    expect(r.credits).toEqual([{ fyStartYear: 2025, ratePct: 8.25, rateIsEstimate: false, interestPaise: R(8250) }])
  })

  it('EPF: monthly contributions count from the month they are credited', () => {
    const flows = Array.from({ length: 12 }, (_, i) => ({ date: addMonths('2025-04-15', i), amountPaise: R(10000) }))
    const r = annualCreditValue({ scheme: 'epf', openingBalancePaise: 0, openingDate: '2025-04-01', flows, ratesByFy: { 2025: 8.25 }, asOf: '2026-03-31' })
    // Month-end balances 10k, 20k … 120k add to 7.8 lakh; × 8.25% / 12 = 5,362.50 → rounded to ₹5,363
    expect(r.balancePaise).toBe(R(120000 + 5363))
  })

  it('EPF: part of a year shows accrued interest, not yet credited', () => {
    const r = annualCreditValue({ scheme: 'epf', openingBalancePaise: L(1), openingDate: '2025-04-01', flows: [], ratesByFy: { 2025: 8.25 }, asOf: '2025-09-30' })
    expect(r.balancePaise).toBe(L(1))
    expect(r.accruedPaise).toBe(R(4125)) // 6 months
    expect(r.valuePaise).toBe(R(104125))
  })

  it('a year with no declared rate uses the latest one and says so', () => {
    const r = annualCreditValue({ scheme: 'epf', openingBalancePaise: L(1), openingDate: '2025-04-01', flows: [], ratesByFy: { 2025: 8.25 }, asOf: '2027-03-31' })
    expect(r.usesEstimate).toBe(true)
    // 1,08,250 × 8.25% = 8,930.625 → ₹8,931
    expect(r.balancePaise).toBe(R(108250 + 8931))
  })

  it('PPF: a deposit by the 5th earns for that month, after the 5th it starts next month', () => {
    const base = { scheme: 'ppf' as const, openingBalancePaise: 0, openingDate: '2025-04-01', ratesByFy: { 2025: 7.1 }, asOf: '2026-03-31' }
    expect(annualCreditValue({ ...base, flows: [{ date: '2025-04-05', amountPaise: L(1.5) }] }).balancePaise).toBe(R(150000 + 10650))
    // 11 months: 1,50,000 × 7.1% × 11/12 = 9,762.50 → ₹9,763
    expect(annualCreditValue({ ...base, flows: [{ date: '2025-04-06', amountPaise: L(1.5) }] }).balancePaise).toBe(R(150000 + 9763))
  })

  it('refuses an opening date that is not 1 April', () => {
    expect(() =>
      annualCreditValue({ scheme: 'ppf', openingBalancePaise: 0, openingDate: '2025-05-01', flows: [], ratesByFy: { 2025: 7.1 }, asOf: '2026-03-31' }),
    ).toThrow()
  })
})

describe('deposits', () => {
  it('FD with quarterly compounding over one year', () => {
    const v = depositValue({ principalPaise: L(1), ratePct: 7, compounding: 'quarterly', start: '2025-01-01', maturity: '2026-01-01' }, '2026-06-01')
    expect(v.valuePaise).toBe(R(107185.9))
    expect(v.matured).toBe(true)
  })
  it('FD value part way is between principal and maturity value', () => {
    const v = depositValue({ principalPaise: L(1), ratePct: 7, compounding: 'quarterly', start: '2025-01-01', maturity: '2026-01-01' }, '2025-07-01')
    expect(v.valuePaise).toBeGreaterThan(L(1))
    expect(v.valuePaise).toBeLessThan(v.maturityValuePaise)
    expect(v.matured).toBe(false)
  })
  it('NSC: ₹1,000 at 7.7% for 5 years matures at about ₹1,449, the post office figure', () => {
    const v = depositValue({ principalPaise: R(1000), ratePct: 7.7, compounding: 'yearly', start: '2024-04-01', maturity: '2029-04-01' }, '2029-04-01')
    expect(rupees(v.maturityValuePaise)).toBe(1449)
  })
  it('payout schemes stay at principal and pay interest out', () => {
    const scss = { principalPaise: L(15), ratePct: 8.2, compounding: 'quarterly' as const, payout: true, start: '2025-01-01', maturity: '2030-01-01' }
    expect(depositValue(scss, '2027-01-01').valuePaise).toBe(L(15))
    expect(payoutPerPeriod(L(15), 8.2, 'quarterly')).toBe(R(30750))
  })
  it('RD: ₹1,000 a month for a year at 7%', () => {
    const v = recurringDepositValue({ installmentPaise: R(1000), ratePct: 7, start: '2025-01-01', months: 12 }, '2026-01-01')
    expect(rupees(v.maturityValuePaise)).toBe(12464)
    expect(v.valuePaise).toBe(v.maturityValuePaise)
    const mid = recurringDepositValue({ installmentPaise: R(1000), ratePct: 7, start: '2025-01-01', months: 12 }, '2025-03-15')
    // 3 installments (1 Jan, 1 Feb, 1 Mar) plus interest for 73, 42 and 14 days: about ₹14 + ₹8 + ₹3
    expect(rupees(mid.valuePaise)).toBe(3025)
  })
})

describe('loans', () => {
  const home = { principalPaise: L(50), ratePct: 8.5, months: 240, firstEmiDate: '2022-05-05' }

  it('EMI matches the usual figure: ₹50 lakh at 8.5% for 20 years is ₹43,391', () => {
    expect(emi(L(50), 8.5, 240)).toBe(R(43391))
  })

  it('schedule repays exactly the principal in 240 EMIs', () => {
    const rows = loanSchedule(home)
    expect(rows).toHaveLength(240)
    expect(rows.at(-1)!.balancePaise).toBe(0)
    expect(rows.reduce((s, r) => s + r.principalPaise, 0)).toBe(L(50))
    // First month: interest ₹35,416.67 → ₹35,417; principal ₹43,391 − ₹35,417
    expect(rows[0]).toMatchObject({ interestPaise: R(35417), principalPaise: R(7974) })
  })

  it('prepayment keeping the EMI shortens the loan', () => {
    const rows = loanSchedule({ ...home, events: [{ kind: 'prepayment', date: '2023-05-10', amountPaise: L(5), adjust: 'tenure' }] })
    expect(rows.length).toBeLessThan(240)
    expect(rows[20].emiPaise).toBe(R(43391))
    expect(rows.reduce((s, r) => s + r.principalPaise + r.prepaymentPaise, 0)).toBe(L(50))
  })

  it('prepayment keeping the end date lowers the EMI', () => {
    const rows = loanSchedule({ ...home, events: [{ kind: 'prepayment', date: '2023-05-10', amountPaise: L(5), adjust: 'emi' }] })
    expect(rows).toHaveLength(240)
    expect(rows[20].emiPaise).toBeLessThan(R(43391))
    expect(rows.at(-1)!.balancePaise).toBe(0)
  })

  it('a rate rise keeping the EMI makes the loan longer', () => {
    const rows = loanSchedule({ ...home, events: [{ kind: 'rate_change', date: '2023-01-01', ratePct: 9.25, adjust: 'tenure' }] })
    expect(rows.length).toBeGreaterThan(240)
    expect(rows[12].ratePct).toBe(9.25)
    expect(rows.at(-1)!.balancePaise).toBe(0)
  })

  it('status on a date', () => {
    const before = loanStatus(home, '2022-05-01')
    expect(before).toMatchObject({ outstandingPaise: L(50), emisPaid: 0, emisLeft: 240, nextEmiDate: '2022-05-05' })
    const s = loanStatus(home, '2026-11-17')
    expect(s.emisPaid).toBe(55) // May 2022 to Nov 2026
    expect(s.emisLeft).toBe(185)
    expect(s.nextEmiDate).toBe('2026-12-05')
    expect(s.emiPaise).toBe(R(43391))
    expect(s.principalRepaidPaise + s.outstandingPaise).toBe(L(50))
  })
})

describe('goals', () => {
  it('cost of ₹25 lakh today in 10 years at 6% inflation is ₹44.77 lakh, as on the design', () => {
    expect(rupees(futureCost(L(25), 6, 10))).toBe(4477119)
  })

  it('SIP needed is the smallest ₹100 step that reaches the target', () => {
    const target = L(10)
    const sip = sipNeeded(target, 12, 60)
    expect(sip % 10_000).toBe(0)
    expect(sipFutureValue(sip, 12, 60)).toBeGreaterThanOrEqual(target)
    expect(sipFutureValue(sip - 10_000, 12, 60)).toBeLessThan(target)
  })

  it('a yearly top-up raises the SIP every 12 months', () => {
    // ₹1,000 a month for a year, then ₹1,100: with no return, 12,000 + 13,200.
    expect(sipFutureValue(R(1000), 0, 24, 10)).toBe(R(25200))
    expect(sipFutureValue(R(1000), 12, 60, 0)).toBe(sipFutureValue(R(1000), 12, 60))
    // With a 10% top-up the starting SIP needed is lower, and it is still the smallest ₹100 step that reaches the target.
    const flat = sipNeeded(L(25), 11, 120)
    const up = sipNeeded(L(25), 11, 120, 10)
    expect(up).toBeLessThan(flat)
    expect(sipFutureValue(up, 11, 120, 10)).toBeGreaterThanOrEqual(L(25))
    expect(sipFutureValue(up - 10_000, 11, 120, 10)).toBeLessThan(L(25))
  })

  it('plans a goal and reports on track or behind', () => {
    const behind = planGoal({ costTodayPaise: L(25), inflationPct: 6, years: 10, fundedTodayPaise: L(5), expectedReturnPct: 11, plannedSipPaise: R(6000), topUpPct: 0 })
    expect(behind.fundedPct).toBe(20)
    expect(behind.onTrack).toBe(false)
    expect(behind.sipNeededPaise).toBeGreaterThan(R(6000))
    const ok = planGoal({ costTodayPaise: L(25), inflationPct: 6, years: 10, fundedTodayPaise: L(5), expectedReturnPct: 11, plannedSipPaise: behind.sipNeededPaise, topUpPct: 0 })
    expect(ok.onTrack).toBe(true)
    expect(ok.gapPaise).toBe(0)
  })
})

describe('market holdings', () => {
  it('values units without float drift', () => {
    expect(marketValue('1234.567', R(156.23))).toBe(19287640)
    expect(marketValue('10', R(100))).toBe(R(1000))
    expect(() => marketValue('-1', 100)).toThrow()
  })
  it('gain and gain %', () => {
    expect(gain(R(1100), R(1000))).toEqual({ gainPaise: R(100), gainPct: 10 })
    expect(gain(R(100), 0).gainPct).toBeNull()
  })
})
