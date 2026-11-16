/**
 * Calendar dates as 'YYYY-MM-DD' strings (no time zone). Indian financial year runs 1 April to 31 March.
 */
export type ISODate = string

export interface YMD {
  y: number
  m: number // 1-12
  d: number
}

export function parseDate(s: ISODate): YMD {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) throw new Error(`Bad date: ${s}`)
  const ymd = { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) }
  if (ymd.m < 1 || ymd.m > 12 || ymd.d < 1 || ymd.d > daysInMonth(ymd.y, ymd.m)) throw new Error(`Bad date: ${s}`)
  return ymd
}

export function formatDate({ y, m, d }: YMD): ISODate {
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** Add whole months. The 31st lands on the last day of shorter months (31 Jan + 1 month = 28/29 Feb). */
export function addMonths(date: ISODate, months: number): ISODate {
  const { y, m, d } = parseDate(date)
  const total = y * 12 + (m - 1) + months
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return formatDate({ y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) })
}

export function daysBetween(from: ISODate, to: ISODate): number {
  const a = parseDate(from)
  const b = parseDate(to)
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000)
}

/** Month index (y*12 + m-1), handy for month arithmetic. */
export function monthIndex(date: ISODate): number {
  const { y, m } = parseDate(date)
  return y * 12 + (m - 1)
}

/** Whole calendar months from one date to another, ignoring days. */
export function monthsBetween(from: ISODate, to: ISODate): number {
  return monthIndex(to) - monthIndex(from)
}

export interface FinancialYear {
  /** Calendar year in which the FY starts: FY 2026–27 → 2026 */
  startYear: number
  start: ISODate
  end: ISODate
  label: string
}

export function financialYear(date: ISODate): FinancialYear {
  const { y, m } = parseDate(date)
  return financialYearStarting(m >= 4 ? y : y - 1)
}

export function financialYearStarting(startYear: number): FinancialYear {
  return {
    startYear,
    start: `${startYear}-04-01`,
    end: `${startYear + 1}-03-31`,
    label: `FY ${startYear}–${String((startYear + 1) % 100).padStart(2, '0')}`,
  }
}

export function compareDates(a: ISODate, b: ISODate): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b
}
