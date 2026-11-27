/**
 * Holdings: everything the owner has or owes that is not a bank or card transaction. Each holding is
 * one row in the sheet's Holdings tab, and its value today is worked out from the row with the M1
 * calculators: interest schemes from their rate and dates, market holdings from units × price, loans
 * from their EMI schedule, and everything else from the value the owner types.
 */
import { addMonths, financialYear, financialYearStarting, monthsBetween, type ISODate } from './dates'
import { depositValue, recurringDepositValue, type Compounding } from './deposits'
import { loanStatus } from './loans'
import { marketValue } from './market'
import type { Paise } from './money'
import { annualCreditValue } from './savings'

export type HoldingClass = 'retirement' | 'market' | 'deposits' | 'gold_other' | 'liabilities'
export type Method = 'calc' | 'price' | 'manual' | 'loan'

interface TypeInfo {
  label: string
  cls: HoldingClass
  /** How the value is found. */
  method: Method
  /** Fields the add/edit form shows, beyond name and notes. */
  fields: (keyof Holding)[]
  compounding?: Compounding
  payout?: boolean
}

export const HOLDING_TYPES = {
  epf: { label: 'EPF / VPF', cls: 'retirement', method: 'calc', fields: ['institution', 'investedPaise', 'startDate', 'ratePct', 'monthlyPaise'] },
  ppf: { label: 'PPF', cls: 'retirement', method: 'calc', fields: ['institution', 'investedPaise', 'startDate', 'ratePct', 'monthlyPaise', 'maturityDate'] },
  nps: { label: 'NPS', cls: 'retirement', method: 'price', fields: ['institution', 'units', 'pricePaise', 'valuePaise', 'investedPaise', 'monthlyPaise'] },
  ssy: { label: 'Sukanya Samriddhi', cls: 'retirement', method: 'calc', fields: ['institution', 'investedPaise', 'startDate', 'ratePct', 'monthlyPaise', 'maturityDate'] },
  mf: { label: 'Mutual fund', cls: 'market', method: 'price', fields: ['institution', 'code', 'units', 'pricePaise', 'investedPaise', 'monthlyPaise'] },
  stock: { label: 'Stock', cls: 'market', method: 'price', fields: ['institution', 'code', 'units', 'pricePaise', 'investedPaise', 'monthlyPaise'] },
  etf: { label: 'ETF', cls: 'market', method: 'price', fields: ['institution', 'code', 'units', 'pricePaise', 'investedPaise', 'monthlyPaise'] },
  sgb: { label: 'Sovereign Gold Bond', cls: 'market', method: 'price', fields: ['code', 'units', 'pricePaise', 'investedPaise', 'maturityDate'] },
  fd: { label: 'Fixed deposit', cls: 'deposits', method: 'calc', compounding: 'quarterly', fields: ['institution', 'investedPaise', 'ratePct', 'startDate', 'maturityDate', 'compounding', 'payout'] },
  rd: { label: 'Recurring deposit', cls: 'deposits', method: 'calc', compounding: 'quarterly', fields: ['institution', 'monthlyPaise', 'ratePct', 'startDate', 'tenureMonths'] },
  nsc: { label: 'NSC', cls: 'deposits', method: 'calc', compounding: 'yearly', fields: ['investedPaise', 'ratePct', 'startDate', 'maturityDate'] },
  kvp: { label: 'KVP', cls: 'deposits', method: 'calc', compounding: 'yearly', fields: ['investedPaise', 'ratePct', 'startDate', 'maturityDate'] },
  scss: { label: 'SCSS', cls: 'deposits', method: 'calc', compounding: 'quarterly', payout: true, fields: ['investedPaise', 'ratePct', 'startDate', 'maturityDate'] },
  pomis: { label: 'Post Office MIS', cls: 'deposits', method: 'calc', compounding: 'monthly', payout: true, fields: ['investedPaise', 'ratePct', 'startDate', 'maturityDate'] },
  gold: { label: 'Gold / silver', cls: 'gold_other', method: 'manual', fields: ['valuePaise', 'valueDate', 'investedPaise'] },
  property: { label: 'Property', cls: 'gold_other', method: 'manual', fields: ['valuePaise', 'valueDate', 'investedPaise'] },
  cash: { label: 'Cash / wallet', cls: 'gold_other', method: 'manual', fields: ['valuePaise', 'valueDate'] },
  lent: { label: 'Money lent', cls: 'gold_other', method: 'manual', fields: ['valuePaise', 'valueDate', 'maturityDate'] },
  other: { label: 'Other asset', cls: 'gold_other', method: 'manual', fields: ['institution', 'valuePaise', 'valueDate', 'investedPaise'] },
  home_loan: { label: 'Home loan', cls: 'liabilities', method: 'loan', fields: ['institution', 'investedPaise', 'ratePct', 'tenureMonths', 'startDate'] },
  car_loan: { label: 'Car loan', cls: 'liabilities', method: 'loan', fields: ['institution', 'investedPaise', 'ratePct', 'tenureMonths', 'startDate'] },
  personal_loan: { label: 'Personal loan', cls: 'liabilities', method: 'loan', fields: ['institution', 'investedPaise', 'ratePct', 'tenureMonths', 'startDate'] },
  education_loan: { label: 'Education loan', cls: 'liabilities', method: 'loan', fields: ['institution', 'investedPaise', 'ratePct', 'tenureMonths', 'startDate'] },
  borrowed: { label: 'Money borrowed / other dues', cls: 'liabilities', method: 'manual', fields: ['valuePaise', 'valueDate'] },
} satisfies Record<string, TypeInfo>

export type HoldingType = keyof typeof HOLDING_TYPES

export const CLASS_LABELS: Record<HoldingClass, string> = {
  retirement: 'Retirement',
  market: 'Market',
  deposits: 'Deposits & small savings',
  gold_other: 'Gold, property & other',
  liabilities: 'Liabilities',
}

export interface Holding {
  id: string
  type: HoldingType
  name: string
  /** Bank, fund house, broker or lender. */
  institution: string
  /** Scheme code (AMFI) or exchange symbol (NSE:TCS), used to fetch prices. */
  code: string
  /** Units as a decimal string (MF units have 3 decimals). */
  units: string
  pricePaise: Paise | null
  priceDate: ISODate | ''
  /** Money put in. For interest schemes: the balance on the start date. For loans: the amount borrowed. */
  investedPaise: Paise | null
  /** Value typed by the owner (manual holdings, or to override). For liabilities: the amount owed. */
  valuePaise: Paise | null
  valueDate: ISODate | ''
  ratePct: number | null
  /** Opening date (balance date for EPF/PPF/SSY), deposit date, or first EMI date for loans. */
  startDate: ISODate | ''
  maturityDate: ISODate | ''
  compounding: Compounding | ''
  payout: boolean
  /** Monthly contribution (EPF/PPF/SSY/NPS), ongoing SIP (funds, stocks, ETFs) or RD installment. Goals count it. */
  monthlyPaise: Paise | null
  tenureMonths: number | null
  notes: string
  updatedAt: string
  deleted: boolean
}

export interface Valuation {
  /** Positive for assets; negative for liabilities. */
  valuePaise: Paise
  method: Method
  /** Date the value is as of (price date, manual value date, or today for calculated). */
  asOf: ISODate | ''
  /** A short explanation for the screen, e.g. "Calculated at 7.1% from 1 Apr 2026". */
  detail: string
  /** Why the value could not be worked out, if it could not. */
  missing?: string
}

export function typeInfo(t: HoldingType): TypeInfo {
  return HOLDING_TYPES[t]
}

export function isLiability(h: Pick<Holding, 'type'>): boolean {
  return HOLDING_TYPES[h.type].cls === 'liabilities'
}

/** Monthly contributions from the start month up to today, on the 1st, for EPF/PPF/SSY estimates. */
function monthlyFlows(start: ISODate, monthlyPaise: number, until: ISODate) {
  const flows = []
  const n = monthsBetween(start, until)
  for (let i = 1; i <= n; i++) {
    const date = addMonths(start, i).slice(0, 8) + '01'
    if (date <= until) flows.push({ date, amountPaise: monthlyPaise })
  }
  return flows
}

export function valueHolding(h: Holding, today: ISODate): Valuation {
  const info: TypeInfo = HOLDING_TYPES[h.type]
  const sign = info.cls === 'liabilities' ? -1 : 1
  const manual = (): Valuation =>
    h.valuePaise !== null
      ? { valuePaise: sign * h.valuePaise, method: 'manual', asOf: h.valueDate, detail: 'Your value' }
      : { valuePaise: 0, method: 'manual', asOf: '', detail: '', missing: 'Enter the current value' }

  switch (info.method) {
    case 'manual':
      return manual()

    case 'price': {
      if (h.units && h.pricePaise !== null) {
        try {
          return { valuePaise: marketValue(h.units, h.pricePaise), method: 'price', asOf: h.priceDate, detail: `${h.units} units` }
        } catch {
          return { ...manual(), missing: 'Units must be a number like 123.456' }
        }
      }
      if (h.valuePaise !== null) return manual()
      return { valuePaise: 0, method: 'price', asOf: '', detail: '', missing: 'Enter units and price, or the current value' }
    }

    case 'loan': {
      if (h.valuePaise !== null) return manual() // the owner's own figure from the lender wins
      if (!h.investedPaise || h.ratePct === null || !h.tenureMonths || !h.startDate) {
        return { valuePaise: 0, method: 'loan', asOf: '', detail: '', missing: 'Enter amount borrowed, rate, months and first EMI date' }
      }
      const s = loanStatus({ principalPaise: h.investedPaise, ratePct: h.ratePct, months: h.tenureMonths, firstEmiDate: h.startDate }, today)
      return {
        valuePaise: -s.outstandingPaise,
        method: 'loan',
        asOf: today,
        detail: `${s.emisLeft} EMIs left${s.nextEmiDate ? `, next ${s.nextEmiDate}` : ''}`,
      }
    }

    case 'calc': {
      if (h.ratePct === null || !h.startDate) return { ...manual(), missing: h.valuePaise === null ? 'Enter rate and start date' : undefined }
      if (h.type === 'epf' || h.type === 'ppf' || h.type === 'ssy') {
        if (h.investedPaise === null) return { valuePaise: 0, method: 'calc', asOf: '', detail: '', missing: 'Enter the balance on the start date' }
        // The engine starts on 1 April: treat the balance as the opening balance of that financial year.
        const fy = financialYear(h.startDate)
        const r = annualCreditValue({
          scheme: h.type,
          openingBalancePaise: h.investedPaise,
          openingDate: fy.start,
          flows: h.monthlyPaise ? monthlyFlows(h.startDate, h.monthlyPaise, today) : [],
          ratesByFy: { [fy.startYear]: h.ratePct },
          asOf: today < fy.start ? fy.start : today,
        })
        return {
          valuePaise: r.valuePaise,
          method: 'calc',
          asOf: today,
          detail: `Estimated at ${h.ratePct}% from ${financialYearStarting(fy.startYear).label}${r.usesEstimate ? ', same rate assumed for later years' : ''}`,
        }
      }
      if (h.type === 'rd') {
        if (!h.monthlyPaise || !h.tenureMonths) return { valuePaise: 0, method: 'calc', asOf: '', detail: '', missing: 'Enter installment and months' }
        const v = recurringDepositValue({ installmentPaise: h.monthlyPaise, ratePct: h.ratePct, start: h.startDate, months: h.tenureMonths }, today)
        return { valuePaise: v.valuePaise, method: 'calc', asOf: today, detail: v.matured ? 'Matured' : `Matures at ${Math.round(v.maturityValuePaise / 100)}` }
      }
      if (h.investedPaise === null || !h.maturityDate) return { ...manual(), missing: h.valuePaise === null ? 'Enter amount, rate, start and maturity' : undefined }
      const v = depositValue(
        {
          principalPaise: h.investedPaise,
          ratePct: h.ratePct,
          compounding: h.compounding || info.compounding || 'quarterly',
          payout: h.payout || info.payout === true,
          start: h.startDate,
          maturity: h.maturityDate,
        },
        today,
      )
      return { valuePaise: v.valuePaise, method: 'calc', asOf: today, detail: v.matured ? 'Matured: move the money or close this' : `Calculated at ${h.ratePct}%` }
    }
  }
}

export interface PortfolioSummary {
  assetsPaise: Paise
  liabilitiesPaise: Paise
  netPaise: Paise
  byClass: { cls: HoldingClass; totalPaise: Paise; items: { holding: Holding; valuation: Valuation }[] }[]
}

export function summarise(holdings: Holding[], today: ISODate): PortfolioSummary {
  const live = holdings.filter((h) => !h.deleted)
  const order: HoldingClass[] = ['retirement', 'market', 'deposits', 'gold_other', 'liabilities']
  const byClass = order
    .map((cls) => {
      const items = live.filter((h) => HOLDING_TYPES[h.type].cls === cls).map((h) => ({ holding: h, valuation: valueHolding(h, today) }))
      return { cls, totalPaise: items.reduce((s, x) => s + x.valuation.valuePaise, 0), items }
    })
    .filter((g) => g.items.length > 0)
  const assets = byClass.filter((g) => g.cls !== 'liabilities').reduce((s, g) => s + g.totalPaise, 0)
  const liabilities = byClass.filter((g) => g.cls === 'liabilities').reduce((s, g) => s + g.totalPaise, 0)
  return { assetsPaise: assets, liabilitiesPaise: liabilities, netPaise: assets + liabilities, byClass }
}

export function blankHolding(type: HoldingType, id: string): Holding {
  return {
    id, type, name: HOLDING_TYPES[type].label, institution: '', code: '', units: '', pricePaise: null, priceDate: '', investedPaise: null,
    valuePaise: null, valueDate: '', ratePct: null, startDate: '', maturityDate: '', compounding: '', payout: false, monthlyPaise: null,
    tenureMonths: null, notes: '', updatedAt: '', deleted: false,
  }
}
