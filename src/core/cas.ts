/**
 * CAS (Consolidated Account Statement) import. The PDF is turned into lines of text on the device
 * (src/data/pdfText.ts); this file reads those lines. Nothing here leaves the device.
 *
 * Two kinds of statement are understood:
 * - CAMS + KFintech "detailed" CAS (from CAMS, KFintech or MF Central): one block per folio with
 *   "ISIN: INF…", "Closing Unit Balance: …", "NAV on <date>: INR …", "Total Cost Value: …" and
 *   "Market Value on <date>: INR …".
 * - Anything else with one row per holding (CAMS summary, NSDL/CDSL CAS): a line with an ISIN and
 *   numbers. A row is taken only when it holds units, price and value that agree (units × price ≈ value),
 *   so a row read the wrong way is dropped rather than imported wrong.
 *
 * Funds (ISIN INF…) become mutual fund holdings priced every morning from AMFI by ISIN. Shares and
 * bonds (other ISINs) are listed too; the owner gives an NSE symbol to import them.
 */
import { blankHolding, type Holding } from './holdings'
import type { Paise } from './money'
import type { ISODate } from './dates'
import { looseDate } from './parsers/text'

export interface CasFund {
  isin: string
  name: string
  /** Fund house, when the statement names it (e.g. "HDFC Mutual Fund"). */
  amc: string
  folios: string[]
  /** Decimal string, e.g. "1234.567". "0" for a folio that has been sold out. */
  units: string
  navPaise: Paise
  navDate: ISODate | ''
  costPaise: Paise | null
  valuePaise: Paise
}

export interface CasShare {
  isin: string
  name: string
  units: string
  pricePaise: Paise
  valuePaise: Paise
}

export interface CasStatement {
  kind: 'detailed' | 'rows'
  /** The statement's date (the last date it covers), when found. */
  asOf: ISODate | ''
  funds: CasFund[]
  shares: CasShare[]
  /** Funds or rows that were seen but could not be read, by name or ISIN. */
  unread: string[]
}

// ISINs end in a check digit, which keeps out 12-letter words such as INSTITUTIONS.
const ISIN_G = /\bIN[A-Z0-9]{9}\d\b/g
const ISIN_1 = /\bIN[A-Z0-9]{9}\d\b/
const DEC = String.raw`(\d[\d,]*\.\d+)`
const DATE = String.raw`(\d{1,2}[-/ ](?:[A-Za-z]{3,9}|\d{1,2})[-/ ]\d{4})`

/** "1,23,456.789" → "123456.789"; trailing zeros after the point are dropped ("10.000" → "10"). */
export function decimalText(s: string): string {
  const t = s.replace(/,/g, '')
  if (!/^\d+(\.\d+)?$/.test(t)) return ''
  const [i, f = ''] = t.split('.')
  const frac = f.replace(/0+$/, '')
  return `${String(Number(i))}${frac ? '.' + frac : ''}`
}

/** Money with any number of decimals → paise, rounded half up. */
function paise(s: string): Paise | null {
  const t = decimalText(s)
  if (!t) return null
  const [i, f = ''] = t.split('.')
  const two = Number((f + '00').slice(0, 2))
  const up = Number((f + '000').charAt(2)) >= 5 ? 1 : 0
  return Number(i) * 100 + two + up
}

/** Adds decimal strings exactly. */
export function addUnits(a: string, b: string): string {
  const scale = Math.max((a.split('.')[1] ?? '').length, (b.split('.')[1] ?? '').length)
  const big = (x: string) => {
    const [i, f = ''] = x.split('.')
    return BigInt(i + f.padEnd(scale, '0'))
  }
  const sum = (big(a || '0') + big(b || '0')).toString().padStart(scale + 1, '0')
  const out = scale ? `${sum.slice(0, -scale)}.${sum.slice(-scale)}` : sum
  return decimalText(out)
}

/** A folio sold out: closing units of zero. */
export const soldOut = (units: string) => /^0(\.0*)?$/.test(units)

function cleanName(s: string): string {
  return s
    .replace(/^[A-Z0-9]{2,12}\s*-\s*(?=[A-Za-z])/, '') // the registrar's scheme code, e.g. "P8042-"
    .replace(/\((?:Non-Demat|Demat)\)/gi, '')
    .replace(/\(?\s*(?:formerly|erstwhile)[^)]*\)?/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/[\s\-–:]+$/, '')
    .trim()
}

function findAsOf(text: string): ISODate | '' {
  const range = new RegExp(String.raw`\b${DATE}\s+(?:To|to|-)\s+${DATE}`).exec(text)
  if (range) return looseDate(range[2].replace(/ /g, '-')) ?? ''
  const on = new RegExp(String.raw`as (?:on|of)\s+${DATE}`, 'i').exec(text)
  if (on) return looseDate(on[1].replace(/ /g, '-')) ?? ''
  return ''
}

const META = /Folio No|PAN\s*:|KYC|Nominee|Closing Unit|Opening Unit|Registrar|Advisor|Page \d|^\d{1,2}-[A-Za-z]{3}-\d{4}/i

function readDetailed(lines: string[]): { funds: CasFund[]; unread: string[] } {
  const text = lines.join('\n')
  const marks = [...text.matchAll(/ISIN\s*:\s*(IN[A-Z0-9]{10})/g)]
  const funds: CasFund[] = []
  const unread: string[] = []
  marks.forEach((m, i) => {
    const start = m.index
    const end = i + 1 < marks.length ? marks[i + 1].index : text.length
    const block = text.slice(start, end)
    const before = text.slice(0, start)
    const prior = before.split('\n')

    // The scheme's name is on the ISIN line, or on the line above when the PDF wrapped it.
    let name = cleanName(prior[prior.length - 1].replace(/\s*-?\s*$/, ''))
    if (name.length < 8 && prior.length > 1 && !META.test(prior[prior.length - 2])) name = cleanName(`${prior[prior.length - 2]} ${name}`)

    const folioAt = before.lastIndexOf('Folio No')
    const folio = folioAt >= 0 ? /Folio No\.?\s*:?\s*([0-9A-Z]+(?:\s*\/\s*[0-9A-Z]+)?)/.exec(before.slice(folioAt))?.[1].replace(/\s+/g, '') : undefined
    const amc = [...prior].reverse().find((l) => /^[A-Za-z0-9&.'() -]+Mutual Fund$/i.test(l.trim()))?.trim() ?? ''

    const units = new RegExp(String.raw`Closing Unit Balance\s*:?\s*${DEC}`, 'i').exec(block)
    const nav = new RegExp(String.raw`NAV on\s+${DATE}\s*:?\s*(?:INR|Rs\.?|₹)?\s*${DEC}`, 'i').exec(block)
    const cost = new RegExp(String.raw`(?:Total\s+)?Cost Value\s*:?\s*(?:INR|Rs\.?|₹)?\s*${DEC}`, 'i').exec(block)
    const value = new RegExp(String.raw`Market Value on\s+${DATE}\s*:?\s*(?:INR|Rs\.?|₹)?\s*${DEC}`, 'i').exec(block)
    const u = units ? decimalText(units[1]) : ''
    const navPaise = nav ? paise(nav[2]) : null
    if (!u || navPaise === null) {
      unread.push(name || m[1])
      return
    }
    funds.push({
      isin: m[1],
      name: name || m[1],
      amc,
      folios: folio ? [folio] : [],
      units: u,
      navPaise,
      navDate: nav ? (looseDate(nav[1].replace(/ /g, '-')) ?? '') : '',
      costPaise: cost ? paise(cost[1]) : null,
      valuePaise: value ? (paise(value[2]) ?? 0) : 0,
    })
  })
  return { funds, unread }
}

/** Finds units, price and value among a row's numbers: the first three, in order, where units × price ≈ value. */
function triple(nums: string[]): { units: string; price: number; value: number; at: number } | null {
  const n = nums.map((x) => Number(x.replace(/,/g, '')))
  for (let i = 0; i < n.length; i++)
    for (let j = i + 1; j < n.length; j++)
      for (let k = j + 1; k < n.length; k++) {
        const v = n[k]
        if (v <= 0 || n[i] <= 0 || n[j] <= 0) continue
        if (Math.abs(n[i] * n[j] - v) <= Math.max(1, v * 0.005)) return { units: decimalText(nums[i]), price: n[j], value: v, at: i }
      }
  return null
}

function readRows(lines: string[], asOf: ISODate | ''): { funds: CasFund[]; shares: CasShare[]; unread: string[] } {
  const funds: CasFund[] = []
  const shares: CasShare[] = []
  const unread: string[] = []
  lines.forEach((line, idx) => {
    const isins = line.match(ISIN_G)
    if (!isins || isins.length !== 1) return
    const isin = isins[0]
    // A row may wrap onto the next line; take the next line too unless it starts another row.
    const next = lines[idx + 1] ?? ''
    const row = ISIN_1.test(next) ? line : `${line} ${next}`
    const rest = row.replace(isin, ' ')
    const nums = rest.match(/\d[\d,]*\.\d+/g) ?? []
    const t = triple(nums)
    if (!t) {
      if (nums.length >= 2) unread.push(isin)
      return
    }
    // The name: the words before the numbers, without folio numbers and other codes.
    const firstNum = rest.search(/\d[\d,]*\.\d+/)
    const name = cleanName(
      rest
        .slice(0, firstNum)
        .replace(/\b\d[\d/ ]*\b/g, ' ')
        .replace(/\b(?:CAMS|KFINTECH|KARVY|NSDL|CDSL)\b/gi, ' '),
    )
    const pricePaise = Math.round(t.price * 100)
    const valuePaise = Math.round(t.value * 100)
    if (isin.startsWith('INF')) {
      // A cost column, if any, is the number just before the units.
      const cost = t.at > 0 ? paise(nums[t.at - 1]) : null
      funds.push({ isin, name: name || isin, amc: '', folios: [], units: t.units, navPaise: pricePaise, navDate: asOf, costPaise: cost, valuePaise })
    } else {
      shares.push({ isin, name: name || isin, units: t.units, pricePaise, valuePaise })
    }
  })
  return { funds, shares, unread }
}

/** One fund per ISIN: folios of the same scheme are added together. */
function mergeFunds(funds: CasFund[]): CasFund[] {
  const by = new Map<string, CasFund>()
  for (const f of funds) {
    const had = by.get(f.isin)
    if (!had) {
      by.set(f.isin, { ...f, folios: [...f.folios] })
      continue
    }
    had.units = addUnits(had.units, f.units)
    had.valuePaise += f.valuePaise
    had.costPaise = had.costPaise === null && f.costPaise === null ? null : (had.costPaise ?? 0) + (f.costPaise ?? 0)
    for (const x of f.folios) if (!had.folios.includes(x)) had.folios.push(x)
    if (!had.amc) had.amc = f.amc
    if (f.navDate > had.navDate) {
      had.navDate = f.navDate
      had.navPaise = f.navPaise
    }
  }
  return [...by.values()]
}

export function parseCas(lines: string[]): CasStatement {
  const tidy = lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean)
  const text = tidy.join('\n')
  const asOf = findAsOf(text)
  if (/Closing Unit Balance/i.test(text) && /ISIN\s*:/.test(text)) {
    const { funds, unread } = readDetailed(tidy)
    return { kind: 'detailed', asOf, funds: mergeFunds(funds), shares: [], unread }
  }
  const { funds, shares, unread } = readRows(tidy, asOf)
  const sharesByIsin = new Map<string, CasShare>()
  for (const s of shares) {
    const had = sharesByIsin.get(s.isin)
    sharesByIsin.set(s.isin, had ? { ...had, units: addUnits(had.units, s.units), valuePaise: had.valuePaise + s.valuePaise } : s)
  }
  return { kind: 'rows', asOf, funds: mergeFunds(funds), shares: [...sharesByIsin.values()], unread }
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * Which existing holding each fund updates: the mutual fund with the same ISIN, else one with the same
 * name. Each holding is matched at most once. null means "add as a new holding".
 */
export function matchFunds(funds: CasFund[], holdings: Holding[]): Map<string, string | null> {
  const mfs = holdings.filter((h) => h.type === 'mf' && !h.deleted)
  const used = new Set<string>()
  const out = new Map<string, string | null>()
  for (const f of funds) {
    const hit = mfs.find((h) => !used.has(h.id) && h.code.trim().toUpperCase() === f.isin) ?? mfs.find((h) => !used.has(h.id) && norm(h.name) === norm(f.name))
    if (hit) used.add(hit.id)
    out.set(f.isin, hit?.id ?? null)
  }
  return out
}

/**
 * The holding after importing `f`: units, cost and ISIN from the statement. The owner's own name and
 * notes are kept. The price is taken from the statement unless the holding already has a newer one.
 */
export function fundHolding(f: CasFund, base: Holding | null, newId: () => string): Holding {
  const h = base ?? { ...blankHolding('mf', newId()), name: f.name, institution: f.amc }
  const newer = base?.pricePaise != null && base.priceDate !== '' && f.navDate !== '' && base.priceDate > f.navDate
  const folios = f.folios.length ? `Folio ${f.folios.join(', ')}` : ''
  return {
    ...h,
    type: 'mf',
    institution: h.institution || f.amc,
    code: f.isin,
    units: f.units,
    pricePaise: newer ? h.pricePaise : f.navPaise,
    priceDate: newer ? h.priceDate : f.navDate,
    investedPaise: f.costPaise ?? h.investedPaise,
    notes: base ? h.notes : [folios, 'from CAS'].filter(Boolean).join(' · '),
    deleted: false,
  }
}

/** A share from the statement as a stock holding, priced every morning by its NSE symbol. */
export function shareHolding(s: CasShare, symbol: string, base: Holding | null, asOf: ISODate | '', newId: () => string): Holding {
  const h = base ?? { ...blankHolding('stock', newId()), name: s.name }
  return { ...h, code: symbol.trim().toUpperCase(), units: s.units, pricePaise: s.pricePaise, priceDate: asOf, notes: base ? h.notes : `ISIN ${s.isin} · from CAS`, deleted: false }
}
