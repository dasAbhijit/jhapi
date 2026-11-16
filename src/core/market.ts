/** Market-priced holdings: mutual funds, stocks, ETFs, SGBs, REITs. */
import { type Paise } from './money'

/**
 * Value = units × price, rounded to the paisa. Units are kept as a decimal string
 * (mutual fund units have 3 decimals, e.g. "1234.567") so they are never stored as a float.
 */
export function marketValue(units: string, pricePaise: Paise): Paise {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(units.trim())
  if (!m) throw new Error(`Bad units: ${units}`)
  const frac = (m[2] ?? '').padEnd(6, '0')
  const micro = BigInt(m[1]) * 1_000_000n + BigInt(frac) // units × 10^6
  const v = micro * BigInt(pricePaise)
  // Round half up to whole paise.
  return Number((v + 500_000n) / 1_000_000n)
}

/** Gain and gain % against money invested. */
export function gain(valuePaise: Paise, investedPaise: Paise): { gainPaise: Paise; gainPct: number | null } {
  const g = valuePaise - investedPaise
  return { gainPaise: g, gainPct: investedPaise > 0 ? Math.round((g / investedPaise) * 1000) / 10 : null }
}
