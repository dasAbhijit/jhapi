import { useState, type FormEvent } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { accountLabel, type Txn } from '../core/records'
import { formatINR, parseINR } from '../core/money'
import { useStore } from '../data/storeContext'
import { todayIST } from '../data/summary'
import { NotConnected } from '../ui/bits'
import { CATEGORIES } from '../ui/format'

function blank(date: string): Txn {
  return {
    id: crypto.randomUUID(), date, time: '', account: '', direction: 'debit', amountPaise: 0, counterparty: '', category: 'Other',
    channel: 'other', reference: '', balancePaise: null, status: 'manual', source: 'app', note: '', emailId: '', template: '',
    updatedAt: '', deleted: false,
  }
}

export default function TxnEdit() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const nav = useNavigate()
  const { config, data, saveTxn, resolveReview } = useStore()
  const existing = id ? data?.transactions.find((t) => t.id === id) : undefined
  const [t, setT] = useState<Txn>(() => existing ?? blank(params.get('date') ?? todayIST()))
  const [amount, setAmount] = useState(() => (existing ? (existing.amountPaise / 100).toFixed(2).replace(/\.00$/, '') : ''))
  const [err, setErr] = useState<string | null>(null)

  if (!config) return <NotConnected />
  if (id && !existing) return <p className="card muted">This transaction is not in your sheet any more.</p>

  const knownAccounts = [...new Set((data?.transactions ?? []).map((x) => x.account).filter(Boolean))].sort()
  const set = (patch: Partial<Txn>) => setT((cur) => ({ ...cur, ...patch }))

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const paise = parseINR(amount)
    if (!paise) return setErr('Enter an amount, like 450 or 1,250.50.')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(t.date)) return setErr('Pick a date.')
    saveTxn({ ...t, amountPaise: paise, counterparty: t.counterparty.trim(), note: t.note.trim(), account: t.account.trim() })
    const reviewId = params.get('review')
    if (reviewId) resolveReview(reviewId, true)
    nav(-1)
  }

  const remove = () => {
    if (!window.confirm('Delete this transaction? It is marked deleted in the sheet and stops counting.')) return
    saveTxn({ ...t, deleted: true })
    nav(-1)
  }

  const fromEmail = t.source === 'email'

  return (
    <form className="page form" onSubmit={submit} noValidate>
      <div className="title-row">
        <h1>{existing ? 'Transaction' : 'Add transaction'}</h1>
        <button type="button" className="link-btn" onClick={() => nav(-1)}>Cancel</button>
      </div>
      {fromEmail && (
        <p className="muted">
          Read from a bank email{t.template ? ` (${t.template})` : ''}{t.reference ? ` · Ref ${t.reference}` : ''}
          {t.balancePaise !== null ? ` · Balance after ${formatINR(t.balancePaise)}` : ''}.
        </p>
      )}

      <fieldset className="seg" aria-label="Type">
        <label><input type="radio" name="dir" checked={t.direction === 'debit'} onChange={() => set({ direction: 'debit' })} /> Money out</label>
        <label><input type="radio" name="dir" checked={t.direction === 'credit'} onChange={() => set({ direction: 'credit' })} /> Money in</label>
      </fieldset>

      <label className="field">
        <span>Amount (₹)</span>
        <input className="input" inputMode="decimal" autoComplete="off" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      </label>
      <label className="field">
        <span>Date</span>
        <input className="input" type="date" value={t.date} onChange={(e) => set({ date: e.target.value })} required />
      </label>
      <label className="field">
        <span>Paid to / received from</span>
        <input className="input" value={t.counterparty} onChange={(e) => set({ counterparty: e.target.value })} />
      </label>
      <label className="field">
        <span>Category</span>
        <select className="input" value={t.category} onChange={(e) => set({ category: e.target.value })}>
          {[...new Set([...CATEGORIES, t.category])].map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <span>Account</span>
        <input className="input" list="accounts" value={t.account} placeholder="e.g. axis-bank-1111 or Cash" onChange={(e) => set({ account: e.target.value })} />
        <datalist id="accounts">
          {knownAccounts.map((a) => (
            <option key={a} value={a}>{accountLabel(a)}</option>
          ))}
        </datalist>
      </label>
      <label className="field">
        <span>Note</span>
        <textarea className="input" rows={2} value={t.note} onChange={(e) => set({ note: e.target.value })} />
      </label>
      {existing && (
        <label className="check">
          <input
            type="checkbox"
            checked={t.status === 'ignored'}
            onChange={(e) => set({ status: e.target.checked ? 'ignored' : fromEmail ? 'verified' : 'manual' })}
          />{' '}
          Do not count this (a duplicate, or not really spending)
        </label>
      )}
      {err && <p className="banner err" role="alert">{err}</p>}
      <button type="submit" className="btn primary">Save</button>
      {existing && <button type="button" className="btn danger" onClick={remove}>Delete</button>}
    </form>
  )
}
