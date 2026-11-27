import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { FundBuy } from '../core/fundBuys'
import { viewGoal, type Goal, type GoalTag } from '../core/goalPlan'
import { HOLDING_TYPES, valueHolding } from '../core/holdings'
import { formatRupees, formatShort } from '../core/money'
import { useStore } from '../data/storeContext'
import { todayIST } from '../data/summary'
import { NotConnected } from '../ui/bits'

const STATUS: Record<string, string> = {
  added: 'Added',
  'not matched': 'Not added yet',
  duplicate: 'Same purchase, another email',
  'in units already': 'Already in the units',
}

function formatDay(d: string): string {
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

/** The latest purchases from fund emails: one line per purchase (duplicates hidden), newest first. */
export function RecentBuys({ buys, names }: { buys: FundBuy[]; names: Map<string, string> }) {
  const shown = buys.filter((b) => b.status === 'added' || b.status === 'not matched').slice(0, 8)
  if (shown.length === 0) return null
  return (
    <section className="card flush">
      <div className="card-head"><h2>Purchases from emails</h2></div>
      {shown.map((b) => (
        <div key={b.id} className="row">
          <span className="row-main">
            <span className="row-title">{(b.holdingId && names.get(b.holdingId)) || b.fund}</span>
            <span className={b.status === 'not matched' ? 'row-sub neg-text' : 'row-sub'}>
              {formatDay(b.date)} · {STATUS[b.status] ?? b.status}
              {b.status === 'not matched' && b.note ? ` (${b.note})` : ''}
            </span>
          </span>
          <span className="amt">{b.units.startsWith('-') ? `−${b.units.slice(1)}` : `+${b.units}`} units</span>
        </div>
      ))}
      <p className="muted small pad">Read from Zerodha Coin, KFintech and CDSL emails every 10 minutes. Each purchase is added to its fund once; goals move with it. A purchase not added yet is tried again on every check, so adding the fund (or importing a CAS) picks it up.</p>
    </section>
  )
}

export default function FundGoals() {
  const { config, data, saveGoals } = useStore()
  const nav = useNavigate()
  const goals = (data?.goals ?? []).filter((g) => !g.deleted).sort((a, b) => a.targetYear - b.targetYear)
  // Only the owner's edits are kept here; everything else comes from the data, which may load after the screen opens.
  const [edits, setEdits] = useState<Record<string, GoalTag[]>>({})
  if (!config) return <NotConnected />

  const today = todayIST()
  const allHoldings = data?.holdings ?? []
  const holdings = allHoldings
    .filter((h) => !h.deleted && HOLDING_TYPES[h.type].cls !== 'liabilities')
    .map((h) => ({ h, value: valueHolding(h, today).valuePaise }))
    .sort((a, b) => b.value - a.value)
  const names = new Map(allHoldings.map((h) => [h.id, h.name]))
  const tagsOf = (g: Goal) => edits[g.id] ?? g.tags
  const pctOf = (g: Goal, hid: string) => tagsOf(g).find((t) => t.holdingId === hid)?.pct ?? 0
  const setPct = (g: Goal, hid: string, pct: number) =>
    setEdits((cur) => ({ ...cur, [g.id]: [...(cur[g.id] ?? g.tags).filter((t) => t.holdingId !== hid), ...(pct > 0 ? [{ holdingId: hid, pct }] : [])] }))
  const giveAll = (hid: string, gid: string) =>
    setEdits((cur) => ({
      ...cur,
      ...Object.fromEntries(goals.map((g) => [g.id, [...(cur[g.id] ?? g.tags).filter((t) => t.holdingId !== hid), ...(g.id === gid ? [{ holdingId: hid, pct: 100 }] : [])]])),
    }))

  const draft: Goal[] = goals.map((g) => ({ ...g, tags: tagsOf(g) }))
  const same = (a: GoalTag[], b: GoalTag[]) => a.length === b.length && a.every((t) => b.some((u) => u.holdingId === t.holdingId && u.pct === t.pct))
  const changed = draft.filter((g, i) => !same(g.tags, goals[i].tags))
  const over = holdings.filter(({ h }) => goals.reduce((s, g) => s + pctOf(g, h.id), 0) > 100)

  const save = () => {
    if (over.length) return
    saveGoals(changed)
    nav('/goals')
  }

  return (
    <div className="page form">
      <div className="title-row">
        <h1>Funds &amp; goals</h1>
        <Link className="link-btn" to="/goals">Back</Link>
      </div>

      <RecentBuys buys={data?.fundBuys ?? []} names={names} />

      {goals.length === 0 ? (
        <section className="card stack">
          <p className="muted">Add a goal first, then set your funds aside for it here.</p>
          <Link className="btn primary" to="/goals/new">Add a goal</Link>
        </section>
      ) : (
        <>
          <section className="card flush" aria-live="polite">
            <div className="card-head"><h2>Goals</h2></div>
            {draft.map((g) => {
              const v = viewGoal(g, allHoldings, today)
              return (
                <div key={g.id} className="row">
                  <span className="row-main">
                    <span className="row-title">{g.name}</span>
                    <span className="row-sub">{formatShort(v.fundedTodayPaise)} set aside · SIP {formatRupees(v.totalSipPaise)}/month · {Math.round(v.forecast.chance * 100)}% chance</span>
                  </span>
                  <span className={v.plan.onTrack ? 'pill ok' : 'pill behind'}>{v.plan.onTrack ? 'ON TRACK' : 'BEHIND'}</span>
                </div>
              )
            })}
          </section>

          {holdings.length === 0 && <p className="muted">Add holdings in Invest, or import a CAS, then set them aside here.</p>}
          {holdings.map(({ h, value }) => {
            const used = goals.reduce((s, g) => s + pctOf(g, h.id), 0)
            return (
              <section key={h.id} className="card flush">
                <div className="card-head">
                  <h2 className="wrap">{h.name}</h2>
                  <strong className="amt">{formatShort(value)}</strong>
                </div>
                <p className="row-sub pad-x">
                  {HOLDING_TYPES[h.type].label}
                  {h.monthlyPaise ? ` · SIP ${formatRupees(h.monthlyPaise)}/month` : ''}
                </p>
                {goals.map((g) => (
                  <div key={g.id} className="row">
                    <span className="row-main"><span className="row-title">{g.name}</span></span>
                    <span className="pct">
                      <input
                        className="input"
                        aria-label={`Share of ${h.name} for ${g.name}, percent`}
                        inputMode="numeric"
                        placeholder="0"
                        value={pctOf(g, h.id) || ''}
                        onChange={(e) => setPct(g, h.id, Math.min(100, Number(e.target.value.replace(/\D/g, '')) || 0))}
                      />
                      <span aria-hidden="true">%</span>
                    </span>
                  </div>
                ))}
                <div className="row">
                  <span className={used > 100 ? 'row-sub neg-text' : 'row-sub'}>{used > 100 ? `${used}% set aside: lower it to 100%` : `Not set aside: ${100 - used}%`}</span>
                  <select className="input quick" aria-label={`Give all of ${h.name} to a goal`} value="" onChange={(e) => e.target.value && giveAll(h.id, e.target.value)}>
                    <option value="">All of it to…</option>
                    {goals.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                  </select>
                </div>
              </section>
            )
          })}

          {over.length > 0 && <p className="banner err" role="alert">{over.map((x) => x.h.name).join(', ')}: more than 100% set aside.</p>}
          <button type="button" className="btn primary" disabled={changed.length === 0 || over.length > 0} onClick={save}>
            {changed.length === 0 ? 'No changes' : `Save ${changed.length} goal${changed.length === 1 ? '' : 's'}`}
          </button>
          <p className="muted small">A share of a holding brings the same share of its SIP. Goals update as prices and new purchases come in.</p>
        </>
      )}
    </div>
  )
}
