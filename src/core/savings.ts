/**
 * Schemes that credit interest once a year on the monthly balance: EPF/VPF, PPF and Sukanya Samriddhi.
 *
 * Rule used for all three: for each month, interest = balance counted for that month × yearly rate / 12.
 * The year's interest is added up, rounded to the rupee, and credited on 31 March. It does not
 * compound within the year.
 *
 * Which balance counts for a month:
 * - EPF/VPF: the balance at the end of the month, so a contribution counts from the month it is credited.
 * - PPF and SSY: the lowest balance between the 5th and the end of the month, so a deposit made after the
 *   5th counts from the next month, and a withdrawal counts from the month it happens.
 *
 * The owner enters each year's declared rate (`declaredRate` records). A year with no rate yet uses the
 * latest known rate, and the result says it is an estimate.
 */
import { financialYear, financialYearStarting, monthIndex, parseDate, type ISODate } from './dates'
import { roundToRupee, type Paise } from './money'

export type AnnualCreditScheme = 'epf' | 'ppf' | 'ssy'

export interface Flow {
  date: ISODate
  /** + deposit/contribution, − withdrawal */
  amountPaise: Paise
}

export interface AnnualCreditInput {
  scheme: AnnualCreditScheme
  /** Balance on `openingDate`, which must be the first day of a financial year (1 April). */
  openingBalancePaise: Paise
  openingDate: ISODate
  flows: Flow[]
  /** Declared rate in percent per year, keyed by the FY start year (2026 = FY 2026–27). */
  ratesByFy: Record<number, number>
  asOf: ISODate
}

export interface YearCredit {
  fyStartYear: number
  ratePct: number
  rateIsEstimate: boolean
  interestPaise: Paise
}

export interface AnnualCreditResult {
  /** Balance with all interest credited so far, as on `asOf`. */
  balancePaise: Paise
  /** Interest earned in the current, unfinished year. Not yet credited; shown as "accrued". */
  accruedPaise: Paise
  /** Credited balance plus accrued interest: the best estimate of the value today. */
  valuePaise: Paise
  credits: YearCredit[]
  /** True if any year used a guessed rate. */
  usesEstimate: boolean
}

function rateFor(fy: number, rates: Record<number, number>): { ratePct: number; estimate: boolean } {
  if (rates[fy] !== undefined) return { ratePct: rates[fy], estimate: false }
  const known = Object.keys(rates).map(Number).filter((y) => y <= fy)
  const fallback = known.length ? Math.max(...known) : Math.min(...Object.keys(rates).map(Number))
  if (!Number.isFinite(fallback)) throw new Error('No declared rates entered')
  return { ratePct: rates[fallback], estimate: true }
}

/** The month (as a month index) from which a flow is counted in the interest balance. */
function countsFromMonth(scheme: AnnualCreditScheme, flow: Flow): number {
  const mi = monthIndex(flow.date)
  if (scheme === 'epf') return mi
  // PPF/SSY: deposits after the 5th miss that month. Withdrawals reduce the lowest balance immediately.
  if (flow.amountPaise > 0 && parseDate(flow.date).d > 5) return mi + 1
  return mi
}

export function annualCreditValue(input: AnnualCreditInput): AnnualCreditResult {
  const { scheme, openingDate, asOf } = input
  const opening = parseDate(openingDate)
  if (opening.m !== 4 || opening.d !== 1) throw new Error('openingDate must be 1 April')

  const flows = input.flows
    .filter((f) => f.date >= openingDate && f.date <= asOf)
    .map((f) => ({ ...f, from: countsFromMonth(scheme, f) }))

  const lastFy = financialYear(asOf).startYear
  const asOfMonth = monthIndex(asOf)
  const asOfIsYearEnd = asOf === financialYearStarting(lastFy).end

  let credited = input.openingBalancePaise // balance including interest credited so far
  let accrued = 0
  const credits: YearCredit[] = []

  for (let fy = opening.y; fy <= lastFy; fy++) {
    const { ratePct, estimate } = rateFor(fy, input.ratesByFy)
    const firstMonth = fy * 12 + 3 // April
    const lastMonth = firstMonth + 11 // March
    const yearFlows = flows.filter((f) => f.date >= financialYearStarting(fy).start && f.date <= financialYearStarting(fy).end)

    let interest = 0 // paise, unrounded
    for (let mi = firstMonth; mi <= Math.min(lastMonth, asOfMonth); mi++) {
      // A month only earns interest once it has ended, or if asOf is its last day.
      const monthComplete = mi < asOfMonth || (mi === asOfMonth && isLastDayOfMonth(asOf))
      if (!monthComplete) break
      const counted = credited + yearFlows.filter((f) => f.from <= mi).reduce((s, f) => s + f.amountPaise, 0)
      interest += (Math.max(0, counted) * ratePct) / 100 / 12
    }

    const yearFlowTotal = yearFlows.reduce((s, f) => s + f.amountPaise, 0)
    const yearDone = fy < lastFy || asOfIsYearEnd
    if (yearDone) {
      const interestPaise = roundToRupee(interest)
      credits.push({ fyStartYear: fy, ratePct, rateIsEstimate: estimate, interestPaise })
      credited += yearFlowTotal + interestPaise
    } else {
      credited += yearFlowTotal
      accrued = Math.round(interest)
      if (estimate || interest > 0) credits.push({ fyStartYear: fy, ratePct, rateIsEstimate: estimate, interestPaise: 0 })
    }
  }

  return {
    balancePaise: credited,
    accruedPaise: accrued,
    valuePaise: credited + accrued,
    credits,
    usesEstimate: credits.some((c) => c.rateIsEstimate),
  }
}

function isLastDayOfMonth(date: ISODate): boolean {
  const { y, m, d } = parseDate(date)
  return d === new Date(Date.UTC(y, m, 0)).getUTCDate()
}
