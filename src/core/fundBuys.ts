/**
 * Mutual fund purchases (and demat debits) from emails, added to the matching fund's units so the
 * holding, and every goal it is set aside for, moves without another CAS import.
 *
 * Sources (one purchase usually arrives in two or three of them, with the same units):
 * - Zerodha Coin "Allotment report": fund, folio, NAV, amount and units for each fund.
 * - KFintech "Purchase Confirmation" (per fund house): amount, fund, units, NAV date and NAV; folio in the subject.
 * - CDSL "Transactions In Your Demat Account": ISIN, quantity, credit or debit, date. Only fund ISINs (INF…).
 *
 * The script keeps every one in the Fund buys tab and adds each purchase to a holding once:
 * - Matched by ISIN (the holding's code), then by folio (in the holding's notes), then by name.
 * - The same units within 4 days is the same purchase from another email: marked duplicate.
 * - A purchase on or before the holding's units date is already in its units (a CAS import or a hand edit).
 * - Unmatched ones are retried on every run, so adding the fund (or importing a CAS) picks them up.
 */
import type { ISODate } from './dates'
import type { Holding } from './holdings'
import type { Paise } from './money'
import { flatten, looseDate, senderAddress } from './parsers/text'

export type FundSource = 'coin' | 'kfintech' | 'cdsl'

export interface FundSender {
  match: string
  source: FundSource
  dkimDomain: string
}

export const FUND_SENDERS: FundSender[] = [
  { match: 'noreply-coin@qmailer.zerodha.net', source: 'coin', dkimDomain: 'zerodha.net' },
  { match: '@kfintech.com', source: 'kfintech', dkimDomain: 'kfintech.com' },
  { match: 'services@cdslindia.co.in', source: 'cdsl', dkimDomain: 'cdslindia.co.in' },
]

export function findFundSender(from: string): FundSender | null {
  const addr = senderAddress(from).toLowerCase()
  return FUND_SENDERS.find((s) => (s.match.startsWith('@') ? addr.endsWith(s.match) : addr === s.match)) ?? null
}

export type BuyStatus = '' | 'added' | 'duplicate' | 'in units already' | 'not matched'

export interface FundBuy {
  /** Gmail message ID and the row's place in the email, e.g. "18c…#1". */
  id: string
  date: ISODate
  fund: string
  folio: string
  isin: string
  /** Signed decimal string: "528.591" bought, "-10.5" sold. */
  units: string
  navPaise: Paise | null
  amountPaise: Paise | null
  source: FundSource
  holdingId: string
  status: BuyStatus
  /** Why it was not added, for the owner. */
  note: string
  updatedAt: string
}

export type ParsedBuy = Pick<FundBuy, 'date' | 'fund' | 'folio' | 'isin' | 'units' | 'navPaise' | 'amountPaise' | 'source'>

/** Coin and CDSL report a purchase the day after its NAV date; the day before puts all three sources (and a CAS) on the NAV date. */
function dayBefore(d: ISODate): ISODate {
  return new Date(Date.parse(d) - 86_400_000).toISOString().slice(0, 10) as ISODate
}

const num = (s: string) => s.replace(/,/g, '')
const money = (s: string): Paise | null => {
  const n = Number(num(s))
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null
}
/** Units as a plain decimal without trailing zeros ("1,029.360" → "1029.36"), so the same purchase compares equal across emails. */
const units = (s: string) => {
  const t = num(s)
  return /^\d+(\.\d+)?$/.test(t) ? t.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') : ''
}

function coin(text: string, subject: string, receivedAt: string): ParsedBuy[] {
  const date = dayBefore(looseDate(/Allotment report\s*-\s*(\d{2}-\d{2}-\d{4})/i.exec(subject)?.[1] ?? '') ?? (receivedAt.slice(0, 10) as ISODate))
  const start = text.search(/Allotment success/i)
  if (start < 0) return []
  // Only the "Allotment success" section; anything after (failed orders, redemptions) is left alone.
  let section = text.slice(start + 'Allotment success'.length)
  const end = section.search(/Allotment fail|Redemption|Best,|Team Zerodha/i)
  if (end >= 0) section = section.slice(0, end)
  section = section.replace(/\|/g, ' ').replace(/-{3,}/g, ' ').replace(/\s+/g, ' ')
  const out: ParsedBuy[] = []
  for (const chunk of section.split(/\bunits\b/i)) {
    const m = /^(.*?)\s*Folio no\.?\s*:?\s*([0-9A-Z/]+)\s*,?\s*NAV\s*:?\s*₹?\s*([\d,.]+)\s*(?:Stamp Duty\s*:?\s*₹?\s*[\d,.]+)?\s*₹?\s*([\d,]+\.\d+)\s+([\d,]+\.\d+)\s*$/i.exec(chunk.trim())
    if (!m) continue
    const fund = m[1].replace(/^.*\bFund\s+Amount\b/i, '').trim()
    const u = units(m[5])
    if (!fund || !u) continue
    out.push({ date, fund, folio: m[2], isin: '', units: u, navPaise: money(m[3]), amountPaise: money(m[4]), source: 'coin' })
  }
  return out
}

function kfintech(text: string, subject: string): ParsedBuy[] {
  if (!/Purchase Confirmation/i.test(subject)) return []
  const t = text.replace(/\|/g, ' ').replace(/\s+/g, ' ')
  const m = /purchase request for Rs\.?\s*([\d,]+\.?\d*)\s+in\s+(.+?)\.\s*Accordingly\s+([\d,]+\.\d+)\s+units have been allotted as per applicable NAV of\s+(\d{1,2}[/-]\d{1,2}[/-]\d{4})\s+for Rs\.?\s*([\d,.]+)/i.exec(t)
  if (!m) return []
  const date = looseDate(m[4])
  const u = units(m[3])
  if (!date || !u) return []
  const folio = /Purchase Confirmation\s*-\s*([0-9A-Z/]+)\s*$/i.exec(subject.trim())?.[1] ?? ''
  return [{ date, fund: m[2].trim(), folio, isin: '', units: u, navPaise: money(m[5]), amountPaise: money(m[1]), source: 'kfintech' }]
}

function cdsl(text: string, subject: string): ParsedBuy[] {
  if (!/Transactions In Your Demat Account/i.test(subject)) return []
  const t = text.replace(/\|/g, ' ').replace(/\s+/g, ' ')
  const out: ParsedBuy[] = []
  for (const m of t.matchAll(/(?:\b\d+\s+)?([^]*?)\s*\b(INF[A-Z0-9]{8}\d)\s+([\d,]+(?:\.\d+)?)\s+(Credit|Debit)\s+(\d{2}\/\d{2}\/\d{4})/gi)) {
    const u = units(m[3])
    const date = looseDate(m[5])
    if (!u || !date || Number(u) === 0) continue
    const fund = m[1].split('#').pop()!.replace(/^.*Date and Time\s*/i, '').replace(/^\d+\s+/, '').trim()
    out.push({ date: dayBefore(date), fund, folio: '', isin: m[2], units: /debit/i.test(m[4]) ? `-${u}` : u, navPaise: null, amountPaise: null, source: 'cdsl' })
  }
  return out
}

/** Purchases (and demat debits) in one email. [] if it has none. */
export function parseFundEmail(email: { from: string; subject: string; receivedAt: string; text: string }): ParsedBuy[] {
  const sender = findFundSender(email.from)
  if (!sender) return []
  const text = flatten(email.text)
  if (sender.source === 'coin') return coin(text, email.subject, email.receivedAt)
  if (sender.source === 'kfintech') return kfintech(text, email.subject)
  return cdsl(text, email.subject)
}

/** Adds signed decimal strings exactly ("150.5" + "-0.25" = "150.25"). */
export function addSigned(a: string, b: string): string {
  const parts = [a || '0', b || '0'].map((x) => {
    const neg = x.startsWith('-')
    const [i, f = ''] = x.replace(/^[-+]/, '').split('.')
    return { neg, i, f }
  })
  const scale = Math.max(...parts.map((p) => p.f.length))
  const sum = parts.reduce((s, p) => s + (p.neg ? BigInt(-1) : BigInt(1)) * BigInt(p.i + p.f.padEnd(scale, '0')), BigInt(0))
  const neg = sum < BigInt(0)
  const digits = (neg ? -sum : sum).toString().padStart(scale + 1, '0')
  let out = scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}`.replace(/\.?0+$/, '') : digits
  if (out === '') out = '0'
  return neg && out !== '0' ? `-${out}` : out
}

/** Words that differ between how emails and statements write the same fund. */
const NOISE = new Set(['plan', 'option', 'the', 'scheme', 'mutual', 'mf'])
export function fundKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' and ')
    .split(/[^a-z0-9]+/)
    .filter((w) => w && !NOISE.has(w))
    .join(' ')
}

/** The holding a purchase belongs to: same ISIN, else the folio in its notes, else the same name. Only active funds; a tie is no match. */
export function matchBuy(b: Pick<FundBuy, 'isin' | 'folio' | 'fund'>, holdings: Holding[]): Holding | null {
  const funds = holdings.filter((h) => !h.deleted && (h.type === 'mf' || h.type === 'etf'))
  const one = (hs: Holding[]) => (hs.length === 1 ? hs[0] : null)
  if (b.isin) {
    const hit = one(funds.filter((h) => h.code.trim().toUpperCase() === b.isin))
    if (hit) return hit
  }
  if (b.folio) {
    const folio = b.folio.split('/')[0]
    const re = new RegExp(String.raw`(^|[^0-9])${folio}([^0-9]|$)`)
    const hit = one(funds.filter((h) => /folio/i.test(h.notes) && re.test(h.notes)))
    if (hit) return hit
  }
  const key = fundKey(b.fund)
  return key ? one(funds.filter((h) => fundKey(h.name) === key)) : null
}

const days = (a: string, b: string) => Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000

/**
 * Adds the waiting purchases to their holdings. Returns every purchase with its new status, and the
 * holdings that changed (units, cost and updatedAt). Purchases already added or marked are left alone.
 */
export function applyBuys(buys: FundBuy[], holdings: Holding[], now: string): { buys: FundBuy[]; changed: Holding[] } {
  const hs = new Map(holdings.map((h) => [h.id, { ...h }]))
  const changed = new Set<string>()
  const out = buys.map((b) => ({ ...b }))
  const order = out
    .map((b, i) => ({ b, i }))
    .filter(({ b }) => b.status === '' || b.status === 'not matched')
    // Oldest first; on the same day the richer sources (amount and folio) go first.
    .sort((x, y) => x.b.date.localeCompare(y.b.date) || ['coin', 'kfintech', 'cdsl'].indexOf(x.b.source) - ['coin', 'kfintech', 'cdsl'].indexOf(y.b.source) || x.i - y.i)
  for (const { b } of order) {
    const twin = out.find((o) => o !== b && o.status === 'added' && o.units === b.units && days(o.date, b.date) <= 4)
    if (twin) {
      Object.assign(b, { status: 'duplicate', holdingId: twin.holdingId, note: `same as the ${twin.source} email`, updatedAt: now })
      continue
    }
    const h = matchBuy(b, [...hs.values()])
    if (!h) {
      if (b.status !== 'not matched') Object.assign(b, { status: 'not matched', note: 'no fund with this ISIN, folio or name', updatedAt: now })
      continue
    }
    if (h.unitsDate && b.date <= h.unitsDate) {
      Object.assign(b, { status: 'in units already', holdingId: h.id, note: `units were set on ${h.unitsDate}`, updatedAt: now })
      continue
    }
    if (!/^\d+(\.\d+)?$/.test(h.units.trim())) {
      Object.assign(b, { status: 'not matched', holdingId: h.id, note: 'the fund has no units yet; enter them or import a CAS', updatedAt: now })
      continue
    }
    const next = addSigned(h.units.trim(), b.units)
    if (next.startsWith('-')) {
      Object.assign(b, { status: 'not matched', holdingId: h.id, note: 'more units sold than the fund holds', updatedAt: now })
      continue
    }
    h.units = next
    if (b.amountPaise && !b.units.startsWith('-')) h.investedPaise = (h.investedPaise ?? 0) + b.amountPaise
    h.updatedAt = now
    changed.add(h.id)
    Object.assign(b, { status: 'added', holdingId: h.id, note: '', updatedAt: now })
  }
  return { buys: out, changed: [...changed].map((id) => hs.get(id)!) }
}
