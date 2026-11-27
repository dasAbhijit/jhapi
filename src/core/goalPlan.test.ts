import { describe, expect, it } from 'vitest'
import { overAllocated, readTags, viewGoal, writeTags, type Goal } from './goalPlan'
import { blankHolding, type Holding } from './holdings'

const L = (lakh: number) => Math.round(lakh * 1e7)
const h = (p: Partial<Holding>): Holding => ({ ...blankHolding(p.type ?? 'mf', p.id ?? 'h'), ...p })
const goal = (p: Partial<Goal>): Goal => ({
  id: 'g', name: 'College', costTodayPaise: L(25), targetYear: 2036, inflationPct: 6, returnPct: null, sipPaise: 0, topUpPct: 10, tags: [], notes: '',
  updatedAt: '', deleted: false, ...p,
})

describe('goal view', () => {
  const fund = h({ id: 'f', type: 'mf', valuePaise: L(10) })
  const fd = h({ id: 'd', type: 'fd', valuePaise: L(4) })
  const loan = h({ id: 'l', type: 'home_loan', valuePaise: L(40) })

  it('counts each tagged holding by its share, and weights the return by class', () => {
    const v = viewGoal(goal({ tags: [{ holdingId: 'f', pct: 50 }, { holdingId: 'd', pct: 100 }] }), [fund, fd], '2026-11-17')
    expect(v.fundedTodayPaise).toBe(L(9))
    // 5L equity at 11% + 4L deposits at 7%
    expect(v.returnPct).toBeCloseTo((11 * 5 + 7 * 4) / 9, 1)
    expect(v.months).toBe(110) // Nov 2026 → Jan 2036
    expect(v.plan.futureCostPaise).toBeGreaterThan(L(40))
    expect(v.forecast.points.at(-1)!.month).toBe(110)
  })

  it('a goal\'s own return wins; tags to missing holdings or loans are reported', () => {
    const v = viewGoal(goal({ returnPct: 9, tags: [{ holdingId: 'gone', pct: 10 }, { holdingId: 'l', pct: 10 }] }), [loan], '2026-11-17')
    expect(v.returnPct).toBe(9)
    expect(v.brokenTags).toEqual(['gone', 'l'])
    expect(v.fundedTodayPaise).toBe(0)
  })

  it('counts the share of each tagged holding\'s SIP, plus the goal\'s own, all topped up yearly', () => {
    const sipFund = h({ id: 's', type: 'mf', valuePaise: L(2), monthlyPaise: 1_000_000 }) // ₹10,000 a month
    const epf = h({ id: 'e', type: 'epf', investedPaise: L(3), startDate: '2026-04-01', ratePct: 8.25, monthlyPaise: 400_000 })
    const v = viewGoal(goal({ sipPaise: 300_000, tags: [{ holdingId: 's', pct: 50 }, { holdingId: 'e', pct: 25 }] }), [sipFund, epf], '2026-11-17')
    expect(v.parts.map((p) => p.sipPaise)).toEqual([500_000, 100_000])
    expect(v.ongoingSipPaise).toBe(600_000)
    expect(v.totalSipPaise).toBe(900_000)
    expect(v.topUpPct).toBe(10)

    // The same goal with no top-up projects less and needs a higher starting SIP.
    const flat = viewGoal(goal({ sipPaise: 300_000, topUpPct: 0, tags: [{ holdingId: 's', pct: 50 }, { holdingId: 'e', pct: 25 }] }), [sipFund, epf], '2026-11-17')
    expect(flat.plan.projectedPaise).toBeLessThan(v.plan.projectedPaise)
    expect(flat.plan.sipNeededPaise).toBeGreaterThan(v.plan.sipNeededPaise)
    expect(flat.forecast.chance).toBeLessThanOrEqual(v.forecast.chance)
  })

  it('a goal saved before top-ups existed gets the default 10%', () => {
    const old = { ...goal({}), topUpPct: undefined } as unknown as Goal
    expect(viewGoal(old, [], '2026-11-17').topUpPct).toBe(10)
  })

  it('half-typed target years do not crash', () => {
    for (const y of [0, 20, 203, 99999, 2036.5]) expect(() => viewGoal(goal({ targetYear: y }), [], '2026-11-17')).not.toThrow()
  })

  it('finds holdings tagged more than 100% across goals', () => {
    expect(overAllocated([goal({ tags: [{ holdingId: 'f', pct: 70 }] }), goal({ id: 'g2', tags: [{ holdingId: 'f', pct: 40 }] })])).toEqual([{ holdingId: 'f', pct: 110 }])
    expect(overAllocated([goal({ tags: [{ holdingId: 'f', pct: 70 }] }), goal({ id: 'g2', deleted: true, tags: [{ holdingId: 'f', pct: 40 }] })])).toEqual([])
  })
})

describe('tags in the sheet', () => {
  it('round-trips and drops bad parts', () => {
    expect(readTags('abc:50; def:30%')).toEqual([{ holdingId: 'abc', pct: 50 }, { holdingId: 'def', pct: 30 }])
    expect(readTags('abc; :20; x:0; y:150; z:12')).toEqual([{ holdingId: 'z', pct: 12 }])
    expect(writeTags(readTags('a:1; b:2'))).toBe('a:1; b:2')
  })
})
