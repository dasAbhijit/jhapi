/**
 * Prices for market holdings. Bundled into the Apps Script, which fetches them every morning:
 * - Mutual funds: AMFI's daily file of every scheme's NAV (https://www.amfiindia.com/spages/NAVAll.txt),
 *   matched by the holding's AMFI scheme code.
 * - Stocks, ETFs and SGBs: Google Sheets' own GOOGLEFINANCE, by the holding's symbol (e.g. NSE:TCS).
 */
import { looseDate } from './parsers/text'
import type { Holding } from './holdings'
import type { ISODate } from './dates'

export interface Quote {
  pricePaise: number
  date: ISODate
}

/**
 * AMFI lines look like
 * `119551;INF209KA12Z1;INF209KA13Z9;Aditya Birla Sun Life Banking & PSU Debt Fund - DIRECT - IDCW;105.4527;14-Nov-2026`.
 * Headings and fund-house names have no semicolons and are skipped. NAVs that are not numbers ("N.A.") are skipped.
 */
export function parseAmfiNav(text: string): Map<string, Quote> {
  const out = new Map<string, Quote>()
  for (const line of text.split(/\r?\n/)) {
    const parts = line.split(';')
    if (parts.length < 6 || !/^\d+$/.test(parts[0].trim())) continue
    const nav = Number(parts[4].trim())
    const date = looseDate(parts[5].trim())
    if (!Number.isFinite(nav) || nav <= 0 || !date) continue
    out.set(parts[0].trim(), { pricePaise: Math.round(nav * 100), date })
  }
  return out
}

/** Which price source a holding uses, and its key there. null if it has none. */
export function priceKey(h: Pick<Holding, 'type' | 'code' | 'deleted'>): { source: 'amfi' | 'google'; key: string } | null {
  if (h.deleted) return null
  const code = h.code.trim()
  if (!code) return null
  if (h.type === 'mf') return /^\d{4,7}$/.test(code) ? { source: 'amfi', key: code } : null
  if (h.type === 'stock' || h.type === 'etf' || h.type === 'sgb') {
    // A bare symbol is taken as NSE.
    const sym = code.toUpperCase().replace(/\s+/g, '')
    if (!/^([A-Z]+:)?[A-Z0-9&._-]{1,20}$/.test(sym)) return null
    return { source: 'google', key: sym.includes(':') ? sym : `NSE:${sym}` }
  }
  return null
}

export interface PriceUpdate {
  id: string
  pricePaise: number
  priceDate: ISODate
}

/** The holdings whose price changed, given the quotes found. Unchanged prices are not rewritten. */
export function priceUpdates(holdings: Holding[], amfi: Map<string, Quote>, google: Map<string, Quote>): PriceUpdate[] {
  const out: PriceUpdate[] = []
  for (const h of holdings) {
    const k = priceKey(h)
    if (!k) continue
    const q = (k.source === 'amfi' ? amfi : google).get(k.key)
    if (!q) continue
    if (q.pricePaise === h.pricePaise && q.date === h.priceDate) continue
    out.push({ id: h.id, pricePaise: q.pricePaise, priceDate: q.date })
  }
  return out
}
