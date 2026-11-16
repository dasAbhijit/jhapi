/**
 * Reducing-balance loans (home, car, personal, education, loan against property).
 *
 * Each month: interest = outstanding × yearly rate / 12, rounded to the rupee; principal = EMI − interest.
 * EMIs are whole rupees. The last EMI is whatever clears the balance.
 *
 * Rate changes and prepayments take effect from the next EMI after their date. For each one the owner
 * picks what the bank did: keep the EMI and change the number of EMIs left ('tenure', the usual bank
 * default), or keep the end date and change the EMI ('emi').
 */
import { addMonths, type ISODate } from './dates'
import { roundToRupee, type Paise } from './money'

export type Adjust = 'tenure' | 'emi'

export type LoanEvent =
  | { kind: 'rate_change'; date: ISODate; ratePct: number; adjust: Adjust }
  | { kind: 'prepayment'; date: ISODate; amountPaise: Paise; adjust: Adjust }

export interface LoanInput {
  principalPaise: Paise
  ratePct: number
  months: number
  /** Date of the first EMI. Later EMIs fall on the same day of each month. */
  firstEmiDate: ISODate
  events?: LoanEvent[]
}

export interface ScheduleRow {
  n: number
  date: ISODate
  ratePct: number
  emiPaise: Paise
  interestPaise: Paise
  principalPaise: Paise
  prepaymentPaise: Paise
  balancePaise: Paise
}

/** Standard EMI formula, rounded to the rupee: P·r·(1+r)^n / ((1+r)^n − 1). */
export function emi(principalPaise: Paise, ratePct: number, months: number): Paise {
  if (months <= 0) throw new Error('months must be positive')
  const r = ratePct / 100 / 12
  if (r === 0) return roundToRupee(principalPaise / months)
  const f = Math.pow(1 + r, months)
  return roundToRupee((principalPaise * r * f) / (f - 1))
}

/** Months needed to repay `balance` at `emi`, or Infinity if the EMI does not cover the interest. */
export function monthsToRepay(balancePaise: Paise, ratePct: number, emiPaise: Paise): number {
  const r = ratePct / 100 / 12
  if (r === 0) return Math.ceil(balancePaise / emiPaise)
  if (emiPaise <= balancePaise * r) return Infinity
  return Math.ceil(-Math.log(1 - (balancePaise * r) / emiPaise) / Math.log(1 + r))
}

export function loanSchedule(input: LoanInput): ScheduleRow[] {
  const events = [...(input.events ?? [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  let balance = input.principalPaise
  let rate = input.ratePct
  let emiNow = emi(balance, rate, input.months)
  let endN = input.months // EMI number of the planned last EMI
  const rows: ScheduleRow[] = []
  let ei = 0
  let prevDate = addMonths(input.firstEmiDate, -1)

  for (let n = 1; balance > 0 && n <= 1200; n++) {
    const date = addMonths(input.firstEmiDate, n - 1)
    let prepay = 0

    // Apply events dated after the previous EMI and on or before this one.
    while (ei < events.length && events[ei].date <= date) {
      const e = events[ei++]
      if (e.date <= prevDate) continue
      if (e.kind === 'prepayment') {
        const amt = Math.min(e.amountPaise, balance)
        balance -= amt
        prepay += amt
      } else {
        rate = e.ratePct
      }
      const remaining = Math.max(1, endN - n + 1)
      if (balance === 0) break
      if (e.adjust === 'emi') {
        emiNow = emi(balance, rate, remaining)
      } else {
        const m = monthsToRepay(balance, rate, emiNow)
        // If the EMI no longer covers the interest, the bank must raise it: fall back to keeping the end date.
        if (m === Infinity) emiNow = emi(balance, rate, remaining)
        else endN = n - 1 + m
      }
    }
    if (balance === 0) {
      rows.push({ n, date, ratePct: rate, emiPaise: 0, interestPaise: 0, principalPaise: 0, prepaymentPaise: prepay, balancePaise: 0 })
      break
    }

    const interest = roundToRupee((balance * rate) / 100 / 12)
    let principal = emiNow - interest
    if (principal >= balance || n >= endN) principal = balance
    balance -= principal
    rows.push({
      n,
      date,
      ratePct: rate,
      emiPaise: principal + interest,
      interestPaise: interest,
      principalPaise: principal,
      prepaymentPaise: prepay,
      balancePaise: balance,
    })
    prevDate = date
  }
  return rows
}

export interface LoanStatus {
  outstandingPaise: Paise
  emiPaise: Paise
  ratePct: number
  emisPaid: number
  emisLeft: number
  interestPaidPaise: Paise
  principalRepaidPaise: Paise
  nextEmiDate: ISODate | null
  lastEmiDate: ISODate | null
}

/** Where the loan stands on `asOf`, counting EMIs dated on or before it as paid. */
export function loanStatus(input: LoanInput, asOf: ISODate): LoanStatus {
  const rows = loanSchedule(input)
  const paid = rows.filter((r) => r.date <= asOf)
  const left = rows.filter((r) => r.date > asOf && r.emiPaise > 0)
  const last = paid.at(-1)
  return {
    outstandingPaise: last ? last.balancePaise : input.principalPaise,
    emiPaise: left[0]?.emiPaise ?? 0,
    ratePct: left[0]?.ratePct ?? last?.ratePct ?? input.ratePct,
    emisPaid: paid.filter((r) => r.emiPaise > 0).length,
    emisLeft: left.length,
    interestPaidPaise: paid.reduce((s, r) => s + r.interestPaise, 0),
    principalRepaidPaise: paid.reduce((s, r) => s + r.principalPaise + r.prepaymentPaise, 0),
    nextEmiDate: left[0]?.date ?? null,
    lastEmiDate: rows.at(-1)?.date ?? null,
  }
}
