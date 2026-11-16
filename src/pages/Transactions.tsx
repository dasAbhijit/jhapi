import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { accountLabel } from '../core/records'
import { useStore } from '../data/storeContext'
import { groupByDate, todayIST } from '../data/summary'
import { NotConnected, SyncLine, TxnRow } from '../ui/bits'
import { dayLabel } from '../ui/format'

export default function Transactions() {
  const { config, data, resolveReview, readInbox, readingInbox } = useStore()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'review' ? 'review' : 'all'
  const [q, setQ] = useState('')
  const [showReceipts, setShowReceipts] = useState(false)
  const today = todayIST()

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (data?.transactions ?? []).filter((t) => {
      if (t.deleted) return false
      if (t.status === 'receipt' && !showReceipts) return false
      if (!needle) return true
      return [t.counterparty, t.category, t.note, accountLabel(t.account), t.reference, String(t.amountPaise / 100)].some((s) => s.toLowerCase().includes(needle))
    })
  }, [data, q, showReceipts])
  const review = (data?.review ?? []).filter((r) => !r.resolved)

  if (!config) return <NotConnected />

  return (
    <div className="page">
      <div className="title-row">
        <h1>Transactions</h1>
        <Link className="btn primary small" to="/transactions/new">+ Add</Link>
      </div>
      <SyncLine />
      <div className="seg" role="tablist" aria-label="Show">
        <button type="button" role="tab" aria-selected={tab === 'all'} onClick={() => setParams({})}>All</button>
        <button type="button" role="tab" aria-selected={tab === 'review'} onClick={() => setParams({ tab: 'review' })}>
          Needs review{review.length ? ` (${review.length})` : ''}
        </button>
      </div>

      {tab === 'all' ? (
        <>
          <div className="stack-row">
            <label className="sr-only" htmlFor="q">Search</label>
            <input id="q" type="search" className="input" placeholder="Search name, category, amount" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <label className="check">
            <input type="checkbox" checked={showReceipts} onChange={(e) => setShowReceipts(e.target.checked)} /> Show receipts (PhonePe, YONO and similar copies)
          </label>
          {list.length === 0 ? (
            <p className="muted card">{q ? 'Nothing matches.' : 'No transactions yet. They appear within about 10 minutes of a bank email.'}</p>
          ) : (
            groupByDate(list).map((g) => (
              <section key={g.date} className="card flush">
                <h2 className="day">{dayLabel(g.date, today)}</h2>
                {g.items.map((t) => (
                  <TxnRow key={t.id} t={t} />
                ))}
              </section>
            ))
          )}
        </>
      ) : (
        <>
          <p className="muted">
            Bank emails Jhapi could not read, and emails that failed the bank signature check. Add the transaction by hand if it is real, then mark it done.
          </p>
          <button type="button" className="btn" disabled={readingInbox} onClick={() => void readInbox()}>
            {readingInbox ? 'Reading bank emails…' : 'Read bank emails now'}
          </button>
          {review.length === 0 ? (
            <p className="muted card">Nothing to review.</p>
          ) : (
            review.map((r) => (
              <article key={r.id} className={`card stack ${r.status === 'blocked' ? 'blocked' : ''}`}>
                <div className="kv">
                  <strong>{r.status === 'blocked' ? 'Blocked' : 'Not read'}</strong>
                  <span className="row-sub">{r.receivedAt ? dayLabel(r.receivedAt.slice(0, 10), today) : ''}</span>
                </div>
                <p className="subject">{r.subject}</p>
                <p className="row-sub">{r.from} · {r.reason}</p>
                {r.text && (
                  <details>
                    <summary>Email text</summary>
                    <pre className="email-text">{r.text}</pre>
                  </details>
                )}
                <div className="btn-row">
                  {r.status !== 'blocked' && (
                    <Link className="btn" to={`/transactions/new?date=${r.receivedAt.slice(0, 10)}&review=${encodeURIComponent(r.id)}`}>Add by hand</Link>
                  )}
                  <button type="button" className="btn" onClick={() => resolveReview(r.id, true)}>Mark done</button>
                </div>
              </article>
            ))
          )}
        </>
      )}
    </div>
  )
}
