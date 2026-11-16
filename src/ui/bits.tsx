import { Link } from 'react-router-dom'
import { accountLabel, type Txn } from '../core/records'
import { formatINR, formatRupees } from '../core/money'
import { useStore } from '../data/storeContext'

export function Amount({ t, exact = false }: { t: Pick<Txn, 'direction' | 'amountPaise'>; exact?: boolean }) {
  const s = exact ? formatINR(t.amountPaise) : formatRupees(t.amountPaise)
  return <span className={t.direction === 'credit' ? 'amt pos' : 'amt'}>{t.direction === 'credit' ? `+${s}` : `−${s}`}</span>
}

export function TxnRow({ t }: { t: Txn }) {
  const title = t.counterparty || t.channel.toUpperCase() || 'Transaction'
  return (
    <Link to={`/transactions/${encodeURIComponent(t.id)}`} className="row">
      <span className="row-main">
        <span className="row-title">{title}</span>
        <span className="row-sub">
          {[t.account ? accountLabel(t.account) : '', t.category, t.time.slice(0, 5)].filter(Boolean).join(' · ')}
          {t.status === 'ignored' ? ' · not counted' : ''}
        </span>
      </span>
      <Amount t={t} />
    </Link>
  )
}

/** One line under the header: synced time, pending changes, or the last error. */
export function SyncLine() {
  const { syncing, error, data, pendingCount, sync, notice, clearNotice } = useStore()
  const when = data ? new Date(data.pulledAt).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' }) : ''
  return (
    <>
      {error && (
        <div className="banner err" role="alert">
          <span>{error}</span>
          <button type="button" className="link-btn" onClick={() => void sync()}>Try again</button>
        </div>
      )}
      {notice && (
        <div className="banner warn" role="status">
          <span>{notice}</span>
          <button type="button" className="link-btn" onClick={clearNotice}>OK</button>
        </div>
      )}
      <p className="sync-line" aria-live="polite">
        {syncing ? 'Syncing with your sheet…' : data ? `Synced ${when}` : ''}
        {pendingCount > 0 ? ` · ${pendingCount} change(s) waiting to sync` : ''}
      </p>
    </>
  )
}

export function NotConnected() {
  return (
    <section className="card stack">
      <h1>Welcome to Jhapi</h1>
      <p className="muted">
        Connect your Jhapi Google Sheet to see transactions read from your bank emails. You need the sheet's web app address and secret code.
      </p>
      <Link className="btn primary" to="/settings">Connect your sheet</Link>
    </section>
  )
}
