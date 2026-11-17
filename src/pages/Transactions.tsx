import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { shownName } from '../core/aliases'
import { accountLabel, type Txn } from '../core/records'
import { useStore } from '../data/storeContext'
import { groupByDate, todayIST } from '../data/summary'
import { NotConnected, SyncLine, TxnRow } from '../ui/bits'
import { useNames } from '../ui/useNames'
import { CATEGORIES, dayLabel } from '../ui/format'

/** The bar shown while picking transactions: change the category of all picked, or stop counting them. */
function BulkBar({ picked, shown, onPickAll, onClear, onDone }: { picked: Txn[]; shown: number; onPickAll: () => void; onClear: () => void; onDone: (msg: string) => void }) {
  const { saveTxns } = useStore()
  const [category, setCategory] = useState('')
  const n = picked.length
  const many = (k: number) => `${k} transaction${k === 1 ? '' : 's'}`
  const setCat = () => {
    const changed = picked.filter((t) => t.category !== category)
    saveTxns(changed.map((t) => ({ ...t, category })))
    onDone(`${many(changed.length)} now in ${category}.`)
  }
  const setCounted = (count: boolean) => {
    const changed = picked.filter((t) => (t.status === 'ignored') === count)
    saveTxns(changed.map((t) => ({ ...t, status: count ? (t.source === 'email' ? 'verified' : 'manual') : 'ignored' })))
    onDone(count ? `${many(changed.length)} counted again.` : `${many(changed.length)} no longer counted.`)
  }
  return (
    <div className="bulk-bar" role="region" aria-label="Change picked transactions">
      <div className="kv">
        <strong>{n} picked</strong>
        {n < shown ? (
          <button type="button" className="link-btn" onClick={onPickAll}>Pick all {shown} shown</button>
        ) : (
          <button type="button" className="link-btn" onClick={onClear}>Clear</button>
        )}
      </div>
      <div className="btn-row">
        <label className="sr-only" htmlFor="bulk-cat">Category for picked</label>
        <select id="bulk-cat" className="input" value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">Category…</option>
          {CATEGORIES.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <button type="button" className="btn primary" disabled={!n || !category} onClick={setCat}>Set category</button>
      </div>
      <div className="btn-row">
        <button type="button" className="btn" disabled={!n} onClick={() => setCounted(false)}>Don't count</button>
        <button type="button" className="btn" disabled={!n} onClick={() => setCounted(true)}>Count again</button>
      </div>
    </div>
  )
}

export default function Transactions() {
  const { config, data, resolveReview, readInbox, readingInbox } = useStore()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'review' ? 'review' : 'all'
  const [q, setQ] = useState(() => params.get('q') ?? '')
  const [showReceipts, setShowReceipts] = useState(false)
  const [picking, setPicking] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(() => new Set())
  const [done, setDone] = useState('')
  const names = useNames()
  const today = todayIST()

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return (data?.transactions ?? []).filter((t) => {
      if (t.deleted) return false
      if (t.status === 'receipt' && !showReceipts) return false
      if (!needle) return true
      return [t.counterparty, shownName(t.counterparty, names).title, t.category, t.note, accountLabel(t.account), t.reference, String(t.amountPaise / 100)].some((s) => s.toLowerCase().includes(needle))
    })
  }, [data, q, showReceipts, names])
  const review = (data?.review ?? []).filter((r) => !r.resolved)

  if (!config) return <NotConnected />

  const toggle = (id: string) =>
    setPicked((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const stopPicking = () => {
    setPicking(false)
    setPicked(new Set())
  }

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
            <button type="button" className="btn" aria-pressed={picking} onClick={() => {
                if (picking) stopPicking()
                else {
                  setDone('')
                  setPicking(true)
                }
              }}>
              {picking ? 'Done' : 'Pick'}
            </button>
          </div>
          {done && <p className="banner ok-banner" role="status">{done}</p>}
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
                  <TxnRow key={t.id} t={t} names={names} selected={picked.has(t.id)} onToggle={picking ? toggle : undefined} />
                ))}
              </section>
            ))
          )}
          {picking && (
            <BulkBar
              picked={list.filter((t) => picked.has(t.id))}
              shown={list.length}
              onPickAll={() => setPicked(new Set(list.map((t) => t.id)))}
              onClear={() => setPicked(new Set())}
              onDone={(msg) => {
                setDone(msg)
                stopPicking()
              }}
            />
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
