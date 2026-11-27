/**
 * Goal arithmetic: cost in a future year, and the monthly SIP needed to close the gap.
 *
 * - Future cost = cost today × (1 + inflation)^years.
 * - Money already set aside grows at the expected yearly return: current × (1 + return)^years.
 * - SIP needed: a monthly investment made at the start of each month, growing at the monthly rate
 *   equivalent to the yearly return, i = (1 + R)^(1/12) − 1. Future value of n SIPs of P is
 *   P × ((1 + i)^n − 1) / i × (1 + i).
 * - Yearly top-up (step-up SIP): the monthly amount rises by the top-up % every 12 months, so month m
 *   (1-based) invests P × (1 + s)^⌊(m − 1)/12⌋. With a top-up the sum is added up month by month.
 *
 * Forecast bands and chance of success are a separate, simulated calculation (M6).
 */
import { type Paise } from './money'

export function futureCost(todayPaise: Paise, inflationPct: number, years: number): Paise {
  return Math.round(todayPaise * Math.pow(1 + inflationPct / 100, years))
}

export function growLumpSum(paise: Paise, returnPct: number, years: number): Paise {
  return Math.round(paise * Math.pow(1 + returnPct / 100, years))
}

function monthlyRate(returnPct: number): number {
  return Math.pow(1 + returnPct / 100, 1 / 12) - 1
}

/** What ₹1 a month (starting amount, topped up yearly) grows to after `months`. */
function sipFactor(returnPct: number, months: number, topUpPct: number): number {
  const i = monthlyRate(returnPct)
  if (topUpPct === 0) return i === 0 ? months : ((Math.pow(1 + i, months) - 1) * (1 + i)) / i
  let f = 0
  for (let m = 1; m <= months; m++) f += Math.pow(1 + topUpPct / 100, Math.floor((m - 1) / 12)) * Math.pow(1 + i, months - m + 1)
  return f
}

/** The monthly amount in month `m` (1-based) of a SIP starting at `sipPaise` and topped up yearly. */
export function sipInMonth(sipPaise: Paise, topUpPct: number, m: number): number {
  return sipPaise * Math.pow(1 + topUpPct / 100, Math.floor((m - 1) / 12))
}

/** Value after `months` of investing `sipPaise` at the start of each month, raised by `topUpPct` every year. */
export function sipFutureValue(sipPaise: Paise, returnPct: number, months: number, topUpPct = 0): Paise {
  return Math.round(sipPaise * sipFactor(returnPct, months, topUpPct))
}

/** Starting monthly SIP (raised by `topUpPct` every year) that grows to `targetPaise` in `months`, rounded up to the next ₹100. */
export function sipNeeded(targetPaise: Paise, returnPct: number, months: number, topUpPct = 0): Paise {
  if (targetPaise <= 0) return 0
  if (months <= 0) throw new Error('months must be positive')
  return Math.ceil(targetPaise / sipFactor(returnPct, months, topUpPct) / 10_000) * 10_000
}

export interface GoalInput {
  costTodayPaise: Paise
  inflationPct: number
  years: number
  fundedTodayPaise: Paise
  expectedReturnPct: number
  /** Monthly SIP now: the tagged holdings' SIPs plus any other SIP for the goal. */
  plannedSipPaise: Paise
  /** Yearly top-up of the SIP, % (0 = flat). */
  topUpPct: number
}

export interface GoalPlan {
  futureCostPaise: Paise
  /** Funded today as a share of today's cost, 0–100. */
  fundedPct: number
  /** What today's money and the planned SIP grow to by the target year. */
  projectedPaise: Paise
  /** Shortfall in the target year with the planned SIP (0 if on track). */
  gapPaise: Paise
  /** Starting monthly SIP needed, raised by the top-up every year. */
  sipNeededPaise: Paise
  onTrack: boolean
}

export function planGoal(g: GoalInput): GoalPlan {
  const months = Math.round(g.years * 12)
  const target = futureCost(g.costTodayPaise, g.inflationPct, g.years)
  const fromNow = growLumpSum(g.fundedTodayPaise, g.expectedReturnPct, g.years)
  const fromSip = sipFutureValue(g.plannedSipPaise, g.expectedReturnPct, months, g.topUpPct)
  const projected = fromNow + fromSip
  const needed = sipNeeded(target - fromNow, g.expectedReturnPct, months, g.topUpPct)
  return {
    futureCostPaise: target,
    fundedPct: g.costTodayPaise > 0 ? Math.round((g.fundedTodayPaise / g.costTodayPaise) * 100) : 0,
    projectedPaise: projected,
    gapPaise: Math.max(0, target - projected),
    sipNeededPaise: needed,
    onTrack: projected >= target,
  }
}
