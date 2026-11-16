/** All money is integer paise (INR minor units). Never use floats for amounts. */
export type Paise = number

export const CURRENCY_SYMBOL = '₹'

export function formatINR(paise: Paise): string {
  const sign = paise < 0 ? '-' : ''
  const abs = Math.abs(paise)
  const rupees = Math.trunc(abs / 100)
  const frac = String(abs % 100).padStart(2, '0')
  // en-IN grouping: 12,34,567
  const grouped = new Intl.NumberFormat('en-IN').format(rupees)
  return `${sign}${CURRENCY_SYMBOL}${grouped}.${frac}`
}

/** Whole rupees, rounded: 3842049 → "₹38,420". Used where paise are noise (cards, totals). */
export function formatRupees(paise: Paise): string {
  const sign = paise < 0 ? '−' : ''
  const rupees = Math.round(Math.abs(paise) / 100)
  return `${sign}${CURRENCY_SYMBOL}${new Intl.NumberFormat('en-IN').format(rupees)}`
}

/**
 * Short form in lakh and crore, one decimal, trailing ".0" dropped:
 * ₹44.8L, ₹6.4 Cr, ₹2 Cr. Below one lakh it falls back to whole rupees.
 */
export function formatShort(paise: Paise): string {
  const sign = paise < 0 ? '−' : ''
  const rupees = Math.abs(paise) / 100
  const one = (n: number) => (Math.round(n * 10) / 10).toFixed(1).replace(/\.0$/, '')
  if (rupees >= 1e7) return `${sign}${CURRENCY_SYMBOL}${one(rupees / 1e7)} Cr`
  if (rupees >= 1e5) {
    const lakh = one(rupees / 1e5)
    // 99.96 lakh rounds to "100" lakh: show it as crore instead.
    return lakh === '100' ? `${sign}${CURRENCY_SYMBOL}1 Cr` : `${sign}${CURRENCY_SYMBOL}${lakh}L`
  }
  return formatRupees(paise)
}

/** Round a rupee-valued float (e.g. from an interest formula) to whole paise. */
export function toPaise(rupees: number): Paise {
  return Math.round(rupees * 100)
}

/** Round paise to the nearest whole rupee, as EPFO, post office schemes and EMIs do. */
export function roundToRupee(paise: number): Paise {
  return Math.round(paise / 100) * 100
}

/** Parse "1,234.5" -> 123450. Returns null if invalid. */
export function parseINR(input: string): Paise | null {
  const s = input.replace(/[₹,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  const [r, f = ''] = s.split('.')
  return Number(r) * 100 + Number(f.padEnd(2, '0'))
}

/** Like parseINR but allows a leading minus, for discounts. "-50" -> -5000. */
export function parseSignedINR(input: string): Paise | null {
  const t = input.trim()
  const neg = t.startsWith('-') || t.startsWith('−')
  const p = parseINR(neg ? t.slice(1) : t)
  return p === null ? null : neg ? -p : p
}
