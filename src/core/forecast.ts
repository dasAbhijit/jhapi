/**
 * Goal forecast: many simulated futures of "money set aside now + a monthly SIP", each month's return
 * drawn from a normal distribution with the expected yearly return and volatility. Results are shown in
 * today's rupees (divided by inflation), so they compare directly with the goal's cost today.
 *
 * Deterministic: a seeded random generator, so the same inputs always give the same picture.
 * This is an estimate, not a promise; the screens say so.
 */
import type { Paise } from './money'

export interface ForecastInput {
  nowPaise: Paise
  sipPaise: Paise
  months: number
  /** Expected yearly return, % (e.g. 11). */
  returnPct: number
  /** Yearly volatility, % (e.g. 15 for equity, 5 for debt, 0 for a fixed rate). */
  volatilityPct: number
  inflationPct: number
  /** Cost in today's rupees, to work out the chance of reaching it. */
  targetTodayPaise: Paise
  runs?: number
  seed?: number
}

export interface ForecastPoint {
  /** Months from now. */
  month: number
  p10: Paise
  p50: Paise
  p90: Paise
}

export interface Forecast {
  /** One point a year (and the final month), in today's rupees. */
  points: ForecastPoint[]
  /** Share of runs that end at or above the target, 0–1. */
  chance: number
  medianEndPaise: Paise
}

/** Mulberry32: small, fast, good enough for a forecast band. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Standard normal from two uniforms (Box–Muller). */
function normal(r: () => number): number {
  const u = Math.max(r(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r())
}

function percentile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo)
}

export function forecast(input: ForecastInput): Forecast {
  const runs = input.runs ?? 1000
  const months = Math.max(1, Math.round(input.months))
  const r = rng(input.seed ?? 42)
  // Monthly log-return parameters matching the yearly expected return and volatility.
  const sigmaM = input.volatilityPct / 100 / Math.sqrt(12)
  const muM = Math.log(1 + input.returnPct / 100) / 12 - (sigmaM * sigmaM) / 2
  const inflM = Math.pow(1 + input.inflationPct / 100, 1 / 12)
  const marks = new Set<number>()
  for (let m = 12; m < months; m += 12) marks.add(m)
  marks.add(months)
  const at = new Map<number, number[]>([...marks].map((m) => [m, []]))

  for (let k = 0; k < runs; k++) {
    let v = input.nowPaise
    for (let m = 1; m <= months; m++) {
      v = (v + input.sipPaise) * Math.exp(muM + sigmaM * normal(r))
      const bucket = at.get(m)
      if (bucket) bucket.push(v / Math.pow(inflM, m))
    }
  }
  const points: ForecastPoint[] = [{ month: 0, p10: input.nowPaise, p50: input.nowPaise, p90: input.nowPaise }]
  for (const m of [...marks].sort((a, b) => a - b)) {
    const s = at.get(m)!.sort((a, b) => a - b)
    points.push({ month: m, p10: Math.round(percentile(s, 0.1)), p50: Math.round(percentile(s, 0.5)), p90: Math.round(percentile(s, 0.9)) })
  }
  const end = at.get(months)!
  return {
    points,
    chance: end.filter((x) => x >= input.targetTodayPaise).length / end.length,
    medianEndPaise: points[points.length - 1].p50,
  }
}

/** Typical volatility for a holding class, used when a goal mixes holdings. */
export const VOLATILITY: Record<string, number> = { market: 15, retirement: 6, deposits: 1, gold_other: 12, cash: 0 }
