import { Link } from 'react-router-dom'
import { summarise } from '../core/holdings'
import { accountLabel, counts } from '../core/records'
import { formatRupees, formatShort } from '../core/money'
import { useStore } from '../data/storeContext'
import { accounts, groupByDate, monthSummary, todayIST, upcomingDues } from '../data/summary'
import { NotConnected, SyncLine, TxnRow } from '../ui/bits'
import { NetWorthChart } from '../ui/NetWorthChart'
import { dayLabel, monthName } from '../ui/format'

export default function Home() {
  const { config, data } = useStore()
  if (!config) return <NotConnected />
  const today = todayIST()
  const month = today.slice(0, 7)
  const txns = data?.transactions ?? []
  const sum = monthSummary(txns, month)
  const toReview = (data?.review ?? []).filter((r) => !r.resolved).length
  const dues = upcomingDues(data?.statements ?? [], today)
  const accts = accounts(txns)
  const recent = groupByDate(txns.filter(counts)).flatMap((g) => g.items).slice(0, 6)
  const top = sum.byCategory.slice(0, 6)
  const port = summarise(data?.holdings ?? [], today)
  // Bank balances only count when a bank email reported one; cards are left to their statements.
  const cash = accts.filter((a) => a.balancePaise !== null && a.account.includes('-bank-')).reduce((s, a) => s + (a.balancePaise ?? 0), 0)
  const net = port.netPaise + cash
  const max = top[0]?.paise ?? 1

  return (
    <div className="page">
      <header className="hero">
        <span className="hero-label">Spent in {monthName(month)}</span>
        <span className="hero-value">{formatRupees(sum.spentPaise)}</span>
        <span className="hero-sub">Received {formatRupees(sum.receivedPaise)} · transfers and investments not counted</span>
      </header>
      <SyncLine />

      {toReview > 0 && (
        <Link className="banner warn tap" to="/transactions?tab=review">
          <span>{toReview} email{toReview === 1 ? '' : 's'} need review</span>
          <span aria-hidden="true">›</span>
        </Link>
      )}

      <div className="grid">
        <section className="card stack">
          <Link className="tap-card" to="/portfolio">
            <div className="kv">
              <h2>Net worth</h2>
              <strong className="big">{formatRupees(net)}</strong>
            </div>
            <span className="row-sub">
              Holdings {formatShort(port.assetsPaise)} · bank balances {formatShort(cash)} · loans {formatShort(-port.liabilitiesPaise)}
            </span>
          </Link>
          <NetWorthChart snapshots={data?.netWorth ?? []} today={today} />
        </section>
        {dues.length > 0 && (
          <section className="card">
            <h2>Card bills due</h2>
            <ul className="plain">
              {dues.map((d) => (
                <li key={d.id} className="kv">
                  <span>
                    {accountLabel(d.account)}
                    <span className="row-sub block">Due {dayLabel(d.dueDate, today)}</span>
                  </span>
                  <strong>{formatRupees(d.totalDuePaise)}</strong>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="card">
          <h2>Where it went</h2>
          {top.length === 0 ? (
            <p className="muted">No spending yet this month.</p>
          ) : (
            <ul className="plain bars">
              {top.map((c) => (
                <li key={c.category}>
                  <div className="kv">
                    <span>{c.category}</span>
                    <strong>{formatRupees(c.paise)}</strong>
                  </div>
                  <div className="bar" role="img" aria-label={`${c.category}: ${Math.round((c.paise / sum.spentPaise) * 100)}% of spending`}>
                    <span style={{ width: `${Math.max(2, (c.paise / max) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <h2>Accounts</h2>
          {accts.length === 0 ? (
            <p className="muted">Accounts appear here once bank emails arrive.</p>
          ) : (
            <ul className="plain">
              {accts.map((a) => (
                <li key={a.account} className="kv">
                  <span>
                    {accountLabel(a.account)}
                    <span className="row-sub block">{a.asOf ? `Balance as of ${dayLabel(a.asOf, today)}` : `Last used ${dayLabel(a.lastActivity, today)}`}</span>
                  </span>
                  <strong>{a.balancePaise === null ? '—' : formatRupees(a.balancePaise)}</strong>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card flush">
          <div className="card-head">
            <h2>Recent</h2>
            <Link to="/transactions">See all</Link>
          </div>
          {recent.length === 0 ? <p className="muted pad">Nothing yet.</p> : recent.map((t) => <TxnRow key={t.id} t={t} />)}
        </section>
      </div>
    </div>
  )
}
