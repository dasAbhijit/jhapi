/**
 * Goals: a cost in today's rupees, a target year, and holdings set aside for it (each with a share).
 * A tagged holding brings the same share of its ongoing monthly SIP (or contribution) to the goal, and
 * the goal can have another SIP of its own. All of it rises by the goal's yearly top-up %.
 * Everything here is worked out from the Goals and Holdings tabs; nothing derived is stored.
 */
import { monthsBetween, type ISODate } from './dates'
import { forecast, VOLATILITY, type Forecast } from './forecast'
import { planGoal, type GoalPlan } from './goals'
import { HOLDING_TYPES, valueHolding, type Holding } from './holdings'
import type { Paise } from './money'

export interface GoalTag {
  holdingId: string
  /** Share of the holding set aside for this goal, 0–100. */
  pct: number
}

export interface Goal {
  id: string
  name: string
  costTodayPaise: Paise
  targetYear: number
  inflationPct: number
  /** Expected yearly return of the money for this goal. Empty: worked out from the tagged holdings. */
  returnPct: number | null
  /** Another monthly SIP for this goal, on top of the tagged holdings' SIPs. */
  sipPaise: Paise
  /** Yearly top-up of all the goal's SIPs, %. Empty in the sheet means the default, 10. */
  topUpPct: number
  tags: GoalTag[]
  notes: string
  updatedAt: string
  deleted: boolean
}

/** Default expected yearly return by holding class, used when a goal has no return of its own. */
const CLASS_RETURN: Record<string, number> = { market: 11, retirement: 8, deposits: 7, gold_other: 8 }

/** Yearly SIP top-up for goals that do not set one. */
export const DEFAULT_TOP_UP_PCT = 10

export interface GoalView {
  goal: Goal
  months: number
  fundedTodayPaise: Paise
  returnPct: number
  volatilityPct: number
  /** The tagged holdings' monthly SIPs, each times its share. */
  ongoingSipPaise: Paise
  /** Ongoing plus the goal's own SIP: what goes in each month now. */
  totalSipPaise: Paise
  topUpPct: number
  plan: GoalPlan
  forecast: Forecast
  /** Tagged holdings with the amount counted for this goal. */
  parts: { holding: Holding; pct: number; amountPaise: Paise; sipPaise: Paise }[]
  /** Tags pointing at holdings that no longer exist or are liabilities. */
  brokenTags: string[]
}

export function goalMonths(targetYear: number, today: ISODate): number {
  // Half-typed years (0, 20, 203) must not crash a live preview: treat them as "now".
  if (!Number.isInteger(targetYear) || targetYear < 1000 || targetYear > 9999) return 1
  return Math.max(1, monthsBetween(today, `${targetYear}-01-01`))
}

export function viewGoal(goal: Goal, holdings: Holding[], today: ISODate): GoalView {
  const byId = new Map(holdings.filter((h) => !h.deleted).map((h) => [h.id, h]))
  const parts: GoalView['parts'] = []
  const broken: string[] = []
  for (const t of goal.tags) {
    const h = byId.get(t.holdingId)
    if (!h || HOLDING_TYPES[h.type].cls === 'liabilities') {
      broken.push(t.holdingId)
      continue
    }
    const v = valueHolding(h, today).valuePaise
    parts.push({ holding: h, pct: t.pct, amountPaise: Math.round((v * t.pct) / 100), sipPaise: Math.round(((h.monthlyPaise ?? 0) * t.pct) / 100) })
  }
  const funded = parts.reduce((s, p) => s + p.amountPaise, 0)
  const ongoing = parts.reduce((s, p) => s + p.sipPaise, 0)
  const total = ongoing + goal.sipPaise
  const topUpPct = Number.isFinite(goal.topUpPct) ? goal.topUpPct : DEFAULT_TOP_UP_PCT
  // Weight return and volatility by the money in each class; no tagged money → equity-like defaults.
  const weight = (f: (cls: string) => number, fallback: number) =>
    funded > 0 ? parts.reduce((s, p) => s + f(HOLDING_TYPES[p.holding.type].cls) * p.amountPaise, 0) / funded : fallback
  const returnPct = goal.returnPct ?? Math.round(weight((c) => CLASS_RETURN[c] ?? 8, 11) * 10) / 10
  const volatilityPct = Math.round(weight((c) => VOLATILITY[c] ?? 10, 15) * 10) / 10
  const months = goalMonths(goal.targetYear, today)
  const plan = planGoal({
    costTodayPaise: goal.costTodayPaise,
    inflationPct: goal.inflationPct,
    years: months / 12,
    fundedTodayPaise: funded,
    expectedReturnPct: returnPct,
    plannedSipPaise: total,
    topUpPct,
  })
  const fc = forecast({
    nowPaise: funded,
    sipPaise: total,
    topUpPct,
    months,
    returnPct,
    volatilityPct,
    inflationPct: goal.inflationPct,
    targetTodayPaise: goal.costTodayPaise,
  })
  return { goal, months, fundedTodayPaise: funded, returnPct, volatilityPct, ongoingSipPaise: ongoing, totalSipPaise: total, topUpPct, plan, forecast: fc, parts, brokenTags: broken }
}

/** Holdings tagged to goals for more than 100% in total, with the total. */
export function overAllocated(goals: Goal[]): { holdingId: string; pct: number }[] {
  const sum = new Map<string, number>()
  for (const g of goals) {
    if (g.deleted) continue
    for (const t of g.tags) sum.set(t.holdingId, (sum.get(t.holdingId) ?? 0) + t.pct)
  }
  return [...sum].filter(([, pct]) => pct > 100).map(([holdingId, pct]) => ({ holdingId, pct }))
}

/** Tags as written in the sheet: "id:50; id2:30". Bad parts are dropped. */
export function readTags(s: string): GoalTag[] {
  return s
    .split(/[;\n]/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const i = p.lastIndexOf(':')
      const pct = Number(p.slice(i + 1).replace('%', ''))
      return { holdingId: p.slice(0, i).trim(), pct }
    })
    .filter((t) => t.holdingId && Number.isFinite(t.pct) && t.pct > 0 && t.pct <= 100)
}

export function writeTags(tags: GoalTag[]): string {
  return tags.map((t) => `${t.holdingId}:${t.pct}`).join('; ')
}
