import { describe, expect, it } from 'vitest'
import { forecast } from './forecast'
import { futureCost, sipFutureValue } from './goals'

const L = (lakh: number) => Math.round(lakh * 1e7)
const base = { nowPaise: L(10), sipPaise: L(0.1), months: 120, returnPct: 11, volatilityPct: 15, inflationPct: 6, targetTodayPaise: L(25) }

describe('goal forecast', () => {
  it('is repeatable for the same inputs', () => {
    expect(forecast(base)).toEqual(forecast(base))
  })

  it('with no volatility it matches the plain compounding maths, in today\'s rupees', () => {
    const f = forecast({ ...base, volatilityPct: 0, sipPaise: 0, runs: 10 })
    const nominal = L(10) * Math.pow(1.11, 10)
    const real = nominal / Math.pow(1.06, 10)
    expect(f.medianEndPaise / real).toBeCloseTo(1, 3)
    expect(f.points.at(-1)!.p10).toBe(f.points.at(-1)!.p90)
  })

  it('SIP-only, no volatility: close to the SIP future value (SIP at the start of each month)', () => {
    const f = forecast({ ...base, nowPaise: 0, volatilityPct: 0, inflationPct: 0, runs: 5 })
    expect(f.medianEndPaise / sipFutureValue(L(0.1), 11, 120)).toBeCloseTo(1, 2)
  })

  it('band widens with volatility, has one point a year, and a bigger SIP raises the chance', () => {
    const f = forecast(base)
    expect(f.points.map((p) => p.month)).toEqual([0, 12, 24, 36, 48, 60, 72, 84, 96, 108, 120])
    const last = f.points.at(-1)!
    expect(last.p10).toBeLessThan(last.p50)
    expect(last.p50).toBeLessThan(last.p90)
    const more = forecast({ ...base, sipPaise: L(0.3) })
    expect(more.chance).toBeGreaterThan(f.chance)
    expect(f.chance).toBeGreaterThan(0)
    expect(f.chance).toBeLessThan(1)
  })

  it('target is in today\'s rupees: the same goal costs more later', () => {
    expect(futureCost(L(25), 6, 10)).toBeGreaterThan(L(44))
  })
})
