import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { viewGoal, type Goal, type GoalTag } from '../core/goalPlan'
import { HOLDING_TYPES, valueHolding } from '../core/holdings'
import { formatRupees, formatShort, parseINR } from '../core/money'
import { useStore } from '../data/storeContext'
import { todayIST } from '../data/summary'
import { NotConnected } from '../ui/bits'

function ForecastBand({ points, target, years }: { points: { month: number; p10: number; p50: number; p90: number }[]; target: number; years: number }) {
  const W = 340
  const H = 180
  const max = Math.max(target, ...points.map((p) => p.p90)) * 1.05 || 1
  const x = (m: number) => 10 + (m / points[points.length - 1].month) * (W - 20)
  const y = (v: number) => H - 20 - (v / max) * (H - 30)
  const band = [...points.map((p) => `${x(p.month)},${y(p.p90)}`), ...[...points].reverse().map((p) => `${x(p.month)},${y(p.p10)}`)].join(' ')
  const median = points.map((p) => `${x(p.month)},${y(p.p50)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="band" role="img" aria-label={`Forecast in today's rupees: median ${formatShort(points[points.length - 1].p50)} after ${years} years against a target of ${formatShort(target)}`}>
      <polygon points={band} className="band-fill" />
      <polyline points={median} fill="none" className="band-line" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
      <line x1="10" x2={W - 10} y1={y(target)} y2={y(target)} className="band-target" strokeDasharray="5 4" />
      <text x="10" y={y(target) - 6} className="band-label">Target {formatShort(target)}</text>
      <text x="10" y={H - 4} className="band-axis">Now</text>
      <text x={W - 10} y={H - 4} textAnchor="end" className="band-axis">in {years} yrs</text>
    </svg>
  )
}

export default function GoalEdit() {
  const { id } = useParams()
  const nav = useNavigate()
  const { config, data, saveGoal } = useStore()
  const existing = id ? data?.goals.find((g) => g.id === id) : undefined
  const [g, setG] = useState<Goal>(
    () => existing ?? { id: crypto.randomUUID(), name: '', costTodayPaise: 0, targetYear: new Date().getFullYear() + 10, inflationPct: 6, returnPct: null, sipPaise: 0, tags: [], notes: '', updatedAt: '', deleted: false },
  )
  const [cost, setCost] = useState(existing ? String(existing.costTodayPaise / 100) : '')
  const [sip, setSip] = useState(existing ? String(existing.sipPaise / 100) : '')
  const [err, setErr] = useState<string | null>(null)
  if (!config) return <NotConnected />
  if (id && !existing) return <p className="card muted">This goal is not in your sheet any more.</p>

  const today = todayIST()
  const holdings = (data?.holdings ?? []).filter((h) => !h.deleted && HOLDING_TYPES[h.type].cls !== 'liabilities')
  const costPaise = parseINR(cost) ?? 0
  const sipPaise = sip.trim() ? parseINR(sip) : 0
  const draft: Goal = { ...g, costTodayPaise: costPaise, sipPaise: sipPaise ?? 0 }
  const yearOk = g.targetYear >= Number(today.slice(0, 4)) && g.targetYear <= 2200
  const v = costPaise > 0 && yearOk ? viewGoal(draft, data?.holdings ?? [], today) : null
  const tagOf = (hid: string) => g.tags.find((t) => t.holdingId === hid)
  const setTag = (hid: string, pct: number | null) =>
    setG((cur) => ({ ...cur, tags: [...cur.tags.filter((t) => t.holdingId !== hid), ...(pct ? [{ holdingId: hid, pct } as GoalTag] : [])] }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!g.name.trim()) return setErr('Give the goal a name.')
    if (!(costPaise > 0)) return setErr('Enter what the goal costs today, like 25,00,000.')
    if (sipPaise === null) return setErr('Monthly SIP: enter an amount, or leave it empty.')
    if (!(g.targetYear >= new Date().getFullYear())) return setErr('The target year should be this year or later.')
    saveGoal({ ...draft, name: g.name.trim() })
    nav('/goals')
  }

  return (
    <form className="page form" onSubmit={submit} noValidate>
      <div className="title-row">
        <h1>{existing ? existing.name : 'New goal'}</h1>
        <button type="button" className="link-btn" onClick={() => nav(-1)}>Cancel</button>
      </div>
      <label className="field"><span>Name</span><input className="input" value={g.name} placeholder="e.g. Child's college" onChange={(e) => setG({ ...g, name: e.target.value })} /></label>
      <label className="field"><span>Cost today (₹)</span><input className="input" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} /></label>
      <label className="field"><span>Target year</span><input className="input" inputMode="numeric" value={String(g.targetYear)} onChange={(e) => setG({ ...g, targetYear: Number(e.target.value.replace(/\D/g, '')) || 0 })} /></label>
      <label className="field"><span>Inflation (% a year)</span><input className="input" inputMode="decimal" value={String(g.inflationPct)} onChange={(e) => setG({ ...g, inflationPct: Number(e.target.value) || 0 })} /></label>
      <label className="field"><span>Monthly SIP planned (₹)</span><input className="input" inputMode="decimal" value={sip} onChange={(e) => setSip(e.target.value)} /></label>
      <label className="field">
        <span>Expected return (% a year, leave empty to use the holdings' usual returns)</span>
        <input className="input" inputMode="decimal" value={g.returnPct ?? ''} onChange={(e) => setG({ ...g, returnPct: e.target.value.trim() === '' ? null : Number(e.target.value) })} />
      </label>

      <section className="card flush">
        <div className="card-head"><h2>Set aside for this goal</h2></div>
        {holdings.length === 0 ? (
          <p className="muted pad">Add holdings in Invest first, then set a share of each aside here.</p>
        ) : (
          holdings.map((h) => (
            <div key={h.id} className="row">
              <span className="row-main">
                <span className="row-title">{h.name}</span>
                <span className="row-sub">{formatRupees(valueHolding(h, today).valuePaise)}</span>
              </span>
              <span className="pct">
                <input className="input" aria-label={`Share of ${h.name} for this goal, percent`} inputMode="numeric" value={tagOf(h.id)?.pct ?? ''} placeholder="0" onChange={(e) => setTag(h.id, Math.min(100, Number(e.target.value.replace(/\D/g, '')) || 0))} />
                <span aria-hidden="true">%</span>
              </span>
            </div>
          ))
        )}
      </section>

      {v && (
        <section className="card stack" aria-live="polite">
          <div className="kv"><span>Cost in {g.targetYear}</span><strong>{formatRupees(v.plan.futureCostPaise)}</strong></div>
          <div className="kv"><span>Set aside today</span><strong>{formatRupees(v.fundedTodayPaise)}</strong></div>
          <div className="kv"><span>Monthly SIP needed</span><strong>{formatRupees(v.plan.sipNeededPaise)}</strong></div>
          <ForecastBand points={v.forecast.points} target={g.costTodayPaise || costPaise} years={Math.round(v.months / 12)} />
          <p className={v.forecast.chance >= 0.7 ? 'banner ok-banner' : 'banner warn'}>
            Chance of reaching it: {Math.round(v.forecast.chance * 100)}%. Expected return {v.returnPct}% a year, ups and downs about {v.volatilityPct}%.
          </p>
          <span className="row-sub">Shaded: 8 in 10 simulated futures land here. Line: the middle one. In today's rupees. Not investment advice.</span>
        </section>
      )}
      <label className="field"><span>Notes</span><textarea className="input" rows={2} value={g.notes} onChange={(e) => setG({ ...g, notes: e.target.value })} /></label>
      {err && <p className="banner err" role="alert">{err}</p>}
      <button type="submit" className="btn primary">Save</button>
      {existing && (
        <button type="button" className="btn danger" onClick={() => { if (window.confirm('Remove this goal?')) { saveGoal({ ...g, deleted: true }); nav('/goals') } }}>
          Remove
        </button>
      )}
    </form>
  )
}
