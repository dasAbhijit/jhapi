/** Helpers shared by every bank parser: text clean-up, amounts and the many date formats banks use. */
import { formatDate, parseDate, type ISODate } from '../dates'
import type { Paise } from '../money'

/**
 * Flatten an email body to one line of single spaces. Removes markdown links and table pipes, so the
 * line-per-label layout and the table layout of the same template read the same.
 */
export function flatten(text: string): string {
  return text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [label](url) → label
    .replace(/<[^>]+>/g, ' ') // stray HTML tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\|/g, ' ')
    .replace(/[   ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** "1,00,000.50" / "44500" / "₹ 38227.00" → paise. null if it is not a plain amount. */
export function amountToPaise(s: string): Paise | null {
  const t = s.replace(/[₹,\s]|INR|Rs\.?/gi, '')
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(t)
  if (!m) return null
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
}

/** Amount pattern for regexes: digits with optional Indian/Western commas and decimals. */
export const AMT = String.raw`(\d[\d,]*(?:\.\d{1,2})?)`

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
}

function year(y: string): number {
  const n = Number(y)
  return y.length === 2 ? 2000 + n : n
}

function safe(y: number, m: number, d: number): ISODate | null {
  try {
    const s = formatDate({ y, m, d })
    parseDate(s) // validates
    return s
  } catch {
    return null
  }
}

/**
 * Dates as Indian bank emails write them:
 * 16-11-26, 27-08-2026, 30/03/26, 30.03.26, 21/10/2026 (day first), 20-Oct-2026, 30-Sep-26,
 * Oct 20, 2026, January 05, 2026, Apr 9, 2025.
 */
export function looseDate(s: string): ISODate | null {
  const t = s.trim()
  let m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(t)
  if (m) return safe(year(m[3]), Number(m[2]), Number(m[1]))
  m = /^(\d{1,2})[- ]([A-Za-z]{3,9})[- ,]+(\d{2}|\d{4})$/.exec(t)
  if (m) {
    const mo = MONTHS[m[2].toLowerCase().slice(0, 3)]
    return mo ? safe(year(m[3]), mo, Number(m[1])) : null
  }
  m = /^([A-Za-z]{3,9})\.? (\d{1,2}), ?(\d{4})$/.exec(t)
  if (m) {
    const mo = MONTHS[m[1].toLowerCase().slice(0, 3)]
    return mo ? safe(Number(m[3]), mo, Number(m[2])) : null
  }
  return null
}

/** Date patterns for regexes, matching what looseDate understands. */
export const DATE_NUM = String.raw`(\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4})`
export const DATE_MON = String.raw`(\d{1,2}-[A-Za-z]{3}-\d{2,4})`
export const DATE_WORDS = String.raw`([A-Z][a-z]{2,8}\.? \d{1,2}, ?\d{4})`
export const TIME = String.raw`(\d{2}:\d{2}(?::\d{2})?)`

/** The receivedAt timestamp as an India-time calendar date. */
export function receivedDate(receivedAt: string): ISODate {
  const ms = Date.parse(receivedAt)
  if (Number.isNaN(ms)) throw new Error(`Bad receivedAt: ${receivedAt}`)
  return new Date(ms + 5.5 * 3600_000).toISOString().slice(0, 10)
}

/** Lower-case email address from a From header such as `Axis Bank Alerts <alerts@axis.bank.in>`. */
export function senderAddress(from: string): string {
  const m = /<([^>]+)>/.exec(from)
  return (m ? m[1] : from).trim().toLowerCase()
}

/** Last 4 digits of a masked number such as XX001111 or XXXXX001111; fewer if fewer are shown. */
export function tail(digits: string): string {
  const d = digits.replace(/\D/g, '')
  return d.slice(-4)
}

/** Tidy a counterparty: trim separators and collapse spaces. */
export function clean(s: string | undefined): string | undefined {
  if (s === undefined) return undefined
  const t = s.replace(/\s+/g, ' ').replace(/^[\s/:-]+|[\s/:.-]+$/g, '').trim()
  return t || undefined
}
