/**
 * Fixed-rate deposits: bank and corporate FDs, RDs, and post office schemes (NSC, KVP, SCSS, PO MIS).
 *
 * These are estimates for showing a value between statements. Banks differ in day counts and in how
 * they handle part-quarters, so the owner can always record the real value from a statement.
 *
 * Method: compound interest with fractional periods, A = P × (1 + r/n)^(n × t), with t = days / 365.
 * Schemes that pay interest out (SCSS, PO MIS, non-cumulative FD) are worth their principal; the payouts
 * arrive as bank credits.
 */
import { addMonths, daysBetween, minDate, type ISODate } from './dates'
import { type Paise } from './money'

export type Compounding = 'monthly' | 'quarterly' | 'half-yearly' | 'yearly'

const PERIODS: Record<Compounding, number> = { monthly: 12, quarterly: 4, 'half-yearly': 2, yearly: 1 }

export interface DepositInput {
  principalPaise: Paise
  ratePct: number
  compounding: Compounding
  /** true when interest is paid out (non-cumulative FD, SCSS, PO MIS): value stays at principal. */
  payout?: boolean
  start: ISODate
  maturity: ISODate
}

export interface DepositValue {
  valuePaise: Paise
  maturityValuePaise: Paise
  matured: boolean
}

function grow(principal: number, ratePct: number, compounding: Compounding, days: number): number {
  const n = PERIODS[compounding]
  return principal * Math.pow(1 + ratePct / 100 / n, (n * days) / 365)
}

export function depositValue(input: DepositInput, asOf: ISODate): DepositValue {
  const { principalPaise: p, ratePct, compounding, start, maturity } = input
  if (input.payout) return { valuePaise: p, maturityValuePaise: p, matured: asOf >= maturity }
  const until = minDate(asOf, maturity)
  const days = Math.max(0, daysBetween(start, until))
  return {
    valuePaise: Math.round(grow(p, ratePct, compounding, days)),
    maturityValuePaise: Math.round(grow(p, ratePct, compounding, daysBetween(start, maturity))),
    matured: asOf >= maturity,
  }
}

/** Interest paid out each period by a payout scheme, e.g. SCSS quarterly or PO MIS monthly. */
export function payoutPerPeriod(principalPaise: Paise, ratePct: number, compounding: Compounding): Paise {
  return Math.round((principalPaise * ratePct) / 100 / PERIODS[compounding])
}

export interface RecurringDepositInput {
  installmentPaise: Paise
  ratePct: number
  /** Indian banks compound RDs quarterly. */
  compounding?: Compounding
  start: ISODate
  months: number
}

/**
 * RD: one installment a month from `start`. Each installment grows from its own date.
 * Value as on `asOf` counts only installments already due.
 */
export function recurringDepositValue(input: RecurringDepositInput, asOf: ISODate): DepositValue {
  const { installmentPaise, ratePct, start, months } = input
  const compounding = input.compounding ?? 'quarterly'
  const maturity = addMonths(start, months)
  const until = minDate(asOf, maturity)
  let value = 0
  let atMaturity = 0
  for (let i = 0; i < months; i++) {
    const due = addMonths(start, i)
    atMaturity += grow(installmentPaise, ratePct, compounding, daysBetween(due, maturity))
    if (due <= until) value += grow(installmentPaise, ratePct, compounding, daysBetween(due, until))
  }
  return { valuePaise: Math.round(value), maturityValuePaise: Math.round(atMaturity), matured: asOf >= maturity }
}
