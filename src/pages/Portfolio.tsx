import { Link } from 'react-router-dom'
import { CLASS_LABELS, HOLDING_TYPES, summarise } from '../core/holdings'
import { formatRupees, formatShort } from '../core/money'
import { useStore } from '../data/storeContext'
import { todayIST } from '../data/summary'
import { NotConnected, SyncLine } from '../ui/bits'

const BADGE = { calc: 'CALC', price: 'PRICE', manual: 'MANUAL', loan: 'EMI' } as const

export default function Portfolio() {
  const { config, data, refreshPrices, refreshingPrices } = useStore()
  if (!config) return <NotConnected />
  const today = todayIST()
  const s = summarise(data?.holdings ?? [], today)

  return (
    <div className="page">
      <div className="title-row">
        <h1>Portfolio</h1>
        <Link className="btn primary small" to="/portfolio/new">+ Add</Link>
      </div>
      <SyncLine />
      <header className="hero">
        <span className="hero-label">Net worth from holdings</span>
        <span className="hero-value">{formatRupees(s.netPaise)}</span>
        <span className="hero-sub">
          Assets {formatShort(s.assetsPaise)} · Owed {formatShort(-s.liabilitiesPaise)}
        </span>
      </header>
      {s.byClass.length === 0 ? (
        <section className="card stack">
          <p className="muted">
            Add your EPF, PPF, FDs, mutual funds, gold, property and loans. Values are worked out from rates, dates and prices, or you type them. You can also add rows in the sheet's Holdings tab.
          </p>
          <Link className="btn primary" to="/portfolio/new">Add your first holding</Link>
        </section>
      ) : (
        <div className="grid">
          {s.byClass.map((g) => (
            <section key={g.cls} className="card flush">
              <div className="card-head">
                <h2>{CLASS_LABELS[g.cls]}</h2>
                <strong className={g.totalPaise < 0 ? 'amt neg' : 'amt'}>{formatRupees(g.totalPaise)}</strong>
              </div>
              {g.items.map(({ holding: h, valuation: v }) => (
                <Link key={h.id} to={`/portfolio/${encodeURIComponent(h.id)}`} className="row">
                  <span className="row-main">
                    <span className="row-title">{h.name}</span>
                    <span className="row-sub">
                      <span className="badge">{BADGE[v.method]}</span> {HOLDING_TYPES[h.type].label}
                      {v.missing ? ` · ${v.missing}` : v.detail ? ` · ${v.detail}` : ''}
                    </span>
                  </span>
                  <span className={v.valuePaise < 0 ? 'amt neg' : 'amt'}>{v.missing && v.valuePaise === 0 ? '—' : formatRupees(v.valuePaise)}</span>
                </Link>
              ))}
            </section>
          ))}
        </div>
      )}
      {s.byClass.some((g) => g.items.some((x) => x.holding.code)) && (
        <button type="button" className="btn" disabled={refreshingPrices} onClick={() => void refreshPrices()}>
          {refreshingPrices ? 'Updating prices…' : 'Update prices now'}
        </button>
      )}
      <p className="muted small">CALC = from rate and dates · PRICE = units × price (updated every morning for funds with an AMFI code and stocks with a symbol) · EMI = from the loan schedule · MANUAL = the value you entered. Estimates, not statements.</p>
    </div>
  )
}
