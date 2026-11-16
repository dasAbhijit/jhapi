import { Link } from 'react-router-dom'
import { overAllocated, viewGoal } from '../core/goalPlan'
import { formatRupees, formatShort } from '../core/money'
import { useStore } from '../data/storeContext'
import { todayIST } from '../data/summary'
import { NotConnected, SyncLine } from '../ui/bits'

export default function Goals() {
  const { config, data } = useStore()
  if (!config) return <NotConnected />
  const today = todayIST()
  const holdings = data?.holdings ?? []
  const goals = (data?.goals ?? []).filter((g) => !g.deleted).sort((a, b) => a.targetYear - b.targetYear)
  const views = goals.map((g) => viewGoal(g, holdings, today))
  const onTrack = views.filter((v) => v.plan.onTrack).length
  const gap = views.reduce((s, v) => s + Math.max(0, v.plan.sipNeededPaise - v.goal.sipPaise), 0)
  const over = overAllocated(goals)
  const name = (id: string) => holdings.find((h) => h.id === id)?.name ?? 'a removed holding'

  return (
    <div className="page">
      <div className="title-row">
        <h1>Goals</h1>
        <Link className="btn primary small" to="/goals/new">+ New goal</Link>
      </div>
      <SyncLine />
      {views.length > 0 && (
        <section className="card stat-row">
          <div><span className="row-sub">On track</span><strong className="pos-text">{onTrack}</strong></div>
          <div><span className="row-sub">Behind</span><strong className="neg-text">{views.length - onTrack}</strong></div>
          <div><span className="row-sub">Monthly SIP gap</span><strong>{formatRupees(gap)}</strong></div>
        </section>
      )}
      {over.map((o) => (
        <p key={o.holdingId} className="banner warn">{name(o.holdingId)} is set aside {o.pct}% across goals. Lower the shares to 100% or less.</p>
      ))}
      {views.length === 0 ? (
        <section className="card stack">
          <p className="muted">Add a goal such as a child's college, a home down payment or retirement. Set what it costs today and when you need it, then set holdings aside for it.</p>
          <Link className="btn primary" to="/goals/new">Add your first goal</Link>
        </section>
      ) : (
        <div className="grid">
          {views.map((v) => {
            const pct = Math.min(100, Math.round((v.fundedTodayPaise / v.goal.costTodayPaise) * 100))
            return (
              <Link key={v.goal.id} to={`/goals/${encodeURIComponent(v.goal.id)}`} className="card tap-card stack">
                <div className="kv">
                  <span>
                    <strong className="block">{v.goal.name}</strong>
                    <span className="row-sub">{v.goal.targetYear} · {Math.round(v.months / 12)} years · {v.goal.inflationPct}% inflation</span>
                  </span>
                  <span className={v.plan.onTrack ? 'pill ok' : 'pill behind'}>{v.plan.onTrack ? 'ON TRACK' : 'BEHIND'}</span>
                </div>
                <div className="kv">
                  <span className="row-sub">{formatShort(v.goal.costTodayPaise)} today · {formatShort(v.plan.futureCostPaise)} by {v.goal.targetYear}</span>
                  <strong>{pct}%</strong>
                </div>
                <div className="bar" role="img" aria-label={`${pct} percent funded`}>
                  <span style={{ width: `${pct}%`, background: v.plan.onTrack ? 'var(--pos)' : 'var(--neg)' }} />
                </div>
                <span className="row-sub">
                  Needs {formatRupees(v.plan.sipNeededPaise)}/month · planned {formatRupees(v.goal.sipPaise)} · {Math.round(v.forecast.chance * 100)}% chance
                </span>
              </Link>
            )
          })}
        </div>
      )}
      <p className="muted small">Targets are in today's rupees. Forecasts are estimates from 1,000 simulated futures, not guarantees, and not investment advice.</p>
    </div>
  )
}
