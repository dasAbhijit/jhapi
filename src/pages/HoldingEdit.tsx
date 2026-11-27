import { useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CLASS_LABELS, HOLDING_TYPES, blankHolding, valueHolding, type Holding, type HoldingClass, type HoldingType } from '../core/holdings'
import { formatRupees, parseINR } from '../core/money'
import { useStore } from '../data/storeContext'
import { todayIST } from '../data/summary'
import { NotConnected } from '../ui/bits'

type FieldKey = (typeof HOLDING_TYPES)[HoldingType]['fields'][number]

const MONEY: FieldKey[] = ['investedPaise', 'valuePaise', 'pricePaise', 'monthlyPaise']

function labelFor(k: FieldKey, type: HoldingType): string {
  const loan = HOLDING_TYPES[type].cls === 'liabilities'
  switch (k) {
    case 'institution': return loan ? 'Lender' : 'Bank, fund house or broker'
    case 'code': return type === 'mf' ? 'AMFI scheme code or ISIN (for daily NAV)' : 'NSE symbol, e.g. NSE:TCS'
    case 'units': return 'Units'
    case 'pricePaise': return 'Price per unit (₹)'
    case 'investedPaise':
      return loan ? 'Amount borrowed (₹)' : type === 'epf' || type === 'ppf' || type === 'ssy' ? 'Balance on the start date (₹)' : 'Amount invested (₹)'
    case 'valuePaise': return loan || type === 'borrowed' ? 'Amount owed now (₹)' : 'Current value (₹)'
    case 'valueDate': return 'Value as of'
    case 'ratePct': return 'Interest rate (% a year)'
    case 'startDate': return loan ? 'First EMI date' : type === 'epf' || type === 'ppf' || type === 'ssy' ? 'Balance date (use 1 April)' : 'Start date'
    case 'maturityDate': return type === 'lent' ? 'Due date' : 'Maturity date'
    case 'compounding': return 'Interest compounds'
    case 'payout': return 'Interest is paid out (not added to the deposit)'
    case 'monthlyPaise': return type === 'rd' ? 'Monthly installment (₹)' : HOLDING_TYPES[type].cls === 'market' ? 'Ongoing monthly SIP (₹, leave empty if none)' : 'Monthly contribution (₹)'
    case 'tenureMonths': return loan ? 'Loan length (months)' : 'Length (months)'
  }
  return k
}

function toText(h: Holding, k: FieldKey): string {
  const v = h[k]
  if (v === null || v === undefined) return ''
  if (MONEY.includes(k)) return ((v as number) / 100).toFixed(2).replace(/\.00$/, '')
  return String(v)
}

export default function HoldingEdit() {
  const { id } = useParams()
  const nav = useNavigate()
  const { config, data, saveHolding } = useStore()
  const existing = id ? data?.holdings.find((h) => h.id === id) : undefined
  const [h, setH] = useState<Holding | null>(() => existing ?? null)
  const [text, setText] = useState<Record<string, string>>(() =>
    existing ? Object.fromEntries(HOLDING_TYPES[existing.type].fields.map((k) => [k, toText(existing, k)])) : {},
  )
  const [err, setErr] = useState<string | null>(null)

  if (!config) return <NotConnected />
  if (id && !existing) return <p className="card muted">This holding is not in your sheet any more.</p>

  if (!h) {
    const groups = (Object.keys(CLASS_LABELS) as HoldingClass[]).map((cls) => ({
      cls,
      types: (Object.keys(HOLDING_TYPES) as HoldingType[]).filter((t) => HOLDING_TYPES[t].cls === cls),
    }))
    return (
      <div className="page">
        <div className="title-row">
          <h1>Add a holding</h1>
          <button type="button" className="link-btn" onClick={() => nav(-1)}>Cancel</button>
        </div>
        {groups.map((g) => (
          <section key={g.cls} className="stack">
            <h2 className="group-label">{CLASS_LABELS[g.cls]}</h2>
            <div className="chips">
              {g.types.map((t) => (
                <button key={t} type="button" className="chip" onClick={() => setH(blankHolding(t, crypto.randomUUID()))}>
                  {HOLDING_TYPES[t].label}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    )
  }

  const info = HOLDING_TYPES[h.type]
  const fields = info.fields as readonly FieldKey[]

  /** The holding with the typed text applied, or an error message. */
  const build = (): Holding | string => {
    const out: Holding = { ...h, name: h.name.trim() || info.label }
    for (const k of fields) {
      const s = (text[k] ?? '').trim()
      if (k === 'payout' || k === 'compounding') continue
      if (MONEY.includes(k)) {
        if (!s) { (out[k] as number | null) = null; continue }
        const p = parseINR(s)
        if (p === null) return `${labelFor(k, h.type)}: enter an amount like 1,25,000 or 450.50`
        ;(out[k] as number | null) = p
      } else if (k === 'ratePct' || k === 'tenureMonths') {
        if (!s) { (out[k] as number | null) = null; continue }
        const n = Number(s.replace(/[%,]/g, ''))
        if (!Number.isFinite(n) || n < 0) return `${labelFor(k, h.type)}: enter a number`
        ;(out[k] as number | null) = k === 'tenureMonths' ? Math.round(n) : n
      } else if (k === 'units') {
        if (s && !/^\d+(\.\d{1,6})?$/.test(s)) return 'Units: enter a number like 123.456'
        out.units = s
      } else {
        ;(out[k] as string) = s
      }
    }
    return out
  }

  const preview = build()
  const today = todayIST()
  const v = typeof preview === 'string' ? null : valueHolding(preview, today)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const b = build()
    if (typeof b === 'string') return setErr(b)
    saveHolding(b)
    nav('/portfolio')
  }

  const remove = () => {
    if (!window.confirm('Remove this holding? It is marked deleted in the sheet.')) return
    saveHolding({ ...h, deleted: true })
    nav('/portfolio')
  }

  const input = (k: FieldKey) => {
    const date = k === 'startDate' || k === 'maturityDate' || k === 'valueDate'
    const numeric = MONEY.includes(k) || k === 'ratePct' || k === 'tenureMonths' || k === 'units'
    return (
      <label key={k} className="field">
        <span>{labelFor(k, h.type)}</span>
        <input
          className="input"
          type={date ? 'date' : 'text'}
          inputMode={numeric ? 'decimal' : undefined}
          autoComplete="off"
          value={text[k] ?? ''}
          onChange={(e) => setText((cur) => ({ ...cur, [k]: e.target.value }))}
        />
      </label>
    )
  }

  return (
    <form className="page form" onSubmit={submit} noValidate>
      <div className="title-row">
        <h1>{existing ? h.name : `Add ${info.label}`}</h1>
        <button type="button" className="link-btn" onClick={() => nav(-1)}>Cancel</button>
      </div>
      <label className="field">
        <span>Name</span>
        <input className="input" value={h.name} onChange={(e) => setH({ ...h, name: e.target.value })} />
      </label>
      {fields.map((k) => {
        if (k === 'payout') {
          return (
            <label key={k} className="check">
              <input type="checkbox" checked={h.payout} onChange={(e) => setH({ ...h, payout: e.target.checked })} /> {labelFor(k, h.type)}
            </label>
          )
        }
        if (k === 'compounding') {
          return (
            <label key={k} className="field">
              <span>{labelFor(k, h.type)}</span>
              <select className="input" value={h.compounding} onChange={(e) => setH({ ...h, compounding: e.target.value as Holding['compounding'] })}>
                <option value="">Usual for this type</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Quarterly</option>
                <option value="half-yearly">Half-yearly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
          )
        }
        return input(k)
      })}
      <label className="field">
        <span>Notes</span>
        <textarea className="input" rows={2} value={h.notes} onChange={(e) => setH({ ...h, notes: e.target.value })} />
      </label>
      <section className="card stack" aria-live="polite">
        <div className="kv">
          <span>Value today</span>
          <strong className={v && v.valuePaise < 0 ? 'amt neg' : 'amt'}>{v && !v.missing ? formatRupees(v.valuePaise) : '—'}</strong>
        </div>
        <span className="row-sub">{typeof preview === 'string' ? preview : v?.missing ?? v?.detail}</span>
      </section>
      {err && <p className="banner err" role="alert">{err}</p>}
      <button type="submit" className="btn primary">Save</button>
      {existing && <button type="button" className="btn danger" onClick={remove}>Remove</button>}
    </form>
  )
}
