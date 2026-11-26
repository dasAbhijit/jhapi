import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { fundHolding, matchFunds, parseCas, shareHolding, soldOut, type CasStatement } from '../core/cas'
import type { Holding } from '../core/holdings'
import { formatRupees } from '../core/money'
import { priceKey } from '../core/prices'
import { pdfLines, PdfPasswordError } from '../data/pdfText'
import { useStore } from '../data/storeContext'
import { NotConnected } from '../ui/bits'

const NEW = '+new'
const SKIP = '-skip'

function formatDay(d: string): string {
  if (!d) return ''
  return new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function CasImport() {
  const { config, data, saveHoldings } = useStore()
  const nav = useNavigate()
  const [file, setFile] = useState<File | null>(null)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [cas, setCas] = useState<CasStatement | null>(null)
  /** For each fund ISIN: NEW, SKIP or the ID of the holding it updates. */
  const [choice, setChoice] = useState<Record<string, string>>({})
  /** For each share ISIN: the NSE symbol the owner typed (empty = skip). */
  const [symbols, setSymbols] = useState<Record<string, string>>({})

  if (!config) return <NotConnected />
  const holdings = data?.holdings ?? []
  const mfs = holdings.filter((h) => h.type === 'mf' && !h.deleted)

  const read = async (e: FormEvent) => {
    e.preventDefault()
    if (!file) return setErr('Choose the CAS PDF first.')
    setErr(null)
    setBusy(true)
    try {
      const s = parseCas(await pdfLines(await file.arrayBuffer(), password))
      if (s.funds.length === 0 && s.shares.length === 0) {
        setErr(
          s.unread.length
            ? `Found ${s.unread.length} holding(s) but could not read their units and values. Try the "Detailed" CAS from CAMS or MF Central.`
            : 'No funds or shares found in this PDF. Is it a CAS (Consolidated Account Statement)?',
        )
        return
      }
      const matched = matchFunds(s.funds, holdings)
      const c: Record<string, string> = {}
      for (const f of s.funds) {
        const id = matched.get(f.isin) ?? null
        c[f.isin] = id ?? (soldOut(f.units) ? SKIP : NEW)
      }
      setChoice(c)
      setSymbols({})
      setCas(s)
    } catch (x) {
      setErr(x instanceof PdfPasswordError || x instanceof Error ? x.message : 'Could not read this PDF.')
    } finally {
      setBusy(false)
    }
  }

  if (!cas) {
    return (
      <form className="page form" onSubmit={(e) => void read(e)} noValidate>
        <div className="title-row">
          <h1>Import CAS</h1>
          <Link className="link-btn" to="/portfolio">Cancel</Link>
        </div>
        <p className="muted">
          A CAS (Consolidated Account Statement) lists every mutual fund you hold, with units and cost. Import it once; after that each fund's value is updated every morning from AMFI's NAVs. Import a newer CAS any time to bring units up to date.
        </p>
        <p className="muted small">
          Get one from CAMS (camsonline.com › Statements › CAS – CAMS+KFintech, choose <strong>Detailed</strong>) or MF Central. A CAS from NSDL or CDSL also works, and lists your shares. The PDF is read on this device and is not uploaded anywhere; only the funds you import go to your sheet.
        </p>
        <label className="field">
          <span>CAS PDF</span>
          <input className="input" type="file" accept="application/pdf,.pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <label className="field">
          <span>PDF password</span>
          <input className="input" type="password" autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="Usually your PAN" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {err && <p className="banner err" role="alert">{err}</p>}
        <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Reading…' : 'Read statement'}</button>
      </form>
    )
  }

  const total = cas.funds.reduce((s, f) => s + f.valuePaise, 0) + cas.shares.reduce((s, x) => s + x.valuePaise, 0)
  const taken = new Set(Object.values(choice))
  const untouched = mfs.filter((h) => !taken.has(h.id))
  const plan: Holding[] = []
  for (const f of cas.funds) {
    const c = choice[f.isin]
    if (!c || c === SKIP) continue
    plan.push(fundHolding(f, c === NEW ? null : (holdings.find((h) => h.id === c) ?? null), () => crypto.randomUUID()))
  }
  const badSymbols: string[] = []
  for (const s of cas.shares) {
    const sym = (symbols[s.isin] ?? '').trim()
    if (!sym) continue
    const key = priceKey({ type: 'stock', code: sym, deleted: false })
    if (!key) {
      badSymbols.push(s.name)
      continue
    }
    const base = holdings.find((h) => !h.deleted && (h.type === 'stock' || h.type === 'etf') && priceKey(h)?.key === key.key) ?? null
    plan.push(shareHolding(s, sym, base, cas.asOf, () => crypto.randomUUID()))
  }

  const apply = () => {
    if (badSymbols.length) return setErr(`Check the symbol for ${badSymbols.join(', ')}: letters and digits, e.g. TCS or NSE:TCS.`)
    saveHoldings(plan)
    nav('/portfolio')
  }

  return (
    <div className="page form">
      <div className="title-row">
        <h1>Import CAS</h1>
        <button type="button" className="link-btn" onClick={() => setCas(null)}>Back</button>
      </div>
      <header className="hero">
        <span className="hero-label">In this statement{cas.asOf ? ` (to ${formatDay(cas.asOf)})` : ''}</span>
        <span className="hero-value">{formatRupees(total)}</span>
        <span className="hero-sub">
          {cas.funds.length} fund{cas.funds.length === 1 ? '' : 's'}
          {cas.shares.length ? ` · ${cas.shares.length} share${cas.shares.length === 1 ? '' : 's'}` : ''}
        </span>
      </header>

      {cas.funds.length > 0 && (
        <section className="card flush">
          <div className="card-head"><h2>Mutual funds</h2></div>
          {cas.funds.map((f) => (
            <div key={f.isin} className="row import">
              <span className="row-main">
                <span className="row-title">{f.name}</span>
                <span className="row-sub">
                  {soldOut(f.units) ? 'Sold out' : `${f.units} units`} · NAV ₹{(f.navPaise / 100).toFixed(2)}
                  {f.navDate ? ` on ${formatDay(f.navDate)}` : ''}
                  {f.costPaise !== null ? ` · cost ${formatRupees(f.costPaise)}` : ''}
                </span>
                <select className="input" aria-label={`What to do with ${f.name}`} value={choice[f.isin]} onChange={(e) => setChoice({ ...choice, [f.isin]: e.target.value })}>
                  <option value={NEW}>Add as a new holding</option>
                  {mfs.map((h) => (
                    <option key={h.id} value={h.id} disabled={taken.has(h.id) && choice[f.isin] !== h.id}>Update “{h.name}”</option>
                  ))}
                  <option value={SKIP}>Skip</option>
                </select>
              </span>
              <span className="amt">{formatRupees(f.valuePaise)}</span>
            </div>
          ))}
        </section>
      )}

      {cas.shares.length > 0 && (
        <section className="card flush">
          <div className="card-head"><h2>Shares and bonds</h2></div>
          <p className="muted small pad">Type the NSE symbol (e.g. TCS) for each one to import, so its price can be updated every morning. Leave it empty to skip.</p>
          {cas.shares.map((s) => (
            <div key={s.isin} className="row import">
              <span className="row-main">
                <span className="row-title">{s.name}</span>
                <span className="row-sub">{s.units} at ₹{(s.pricePaise / 100).toFixed(2)} · {s.isin}</span>
                <input className="input" aria-label={`NSE symbol for ${s.name}`} placeholder="NSE symbol" autoCapitalize="characters" autoComplete="off" spellCheck={false} value={symbols[s.isin] ?? ''} onChange={(e) => setSymbols({ ...symbols, [s.isin]: e.target.value })} />
              </span>
              <span className="amt">{formatRupees(s.valuePaise)}</span>
            </div>
          ))}
        </section>
      )}

      {cas.unread.length > 0 && (
        <p className="banner warn" role="status">
          Could not read {cas.unread.length === 1 ? 'this one' : 'these'}, so {cas.unread.length === 1 ? 'it is' : 'they are'} not imported: {cas.unread.join(', ')}. Add {cas.unread.length === 1 ? 'it' : 'them'} by hand if needed.
        </p>
      )}
      {untouched.length > 0 && (
        <p className="muted small">Not in this import, left as they are: {untouched.map((h) => h.name).join(', ')}.</p>
      )}
      {err && <p className="banner err" role="alert">{err}</p>}
      <button type="button" className="btn primary" disabled={plan.length === 0} onClick={apply}>
        {plan.length === 0 ? 'Nothing to import' : `Import ${plan.length} holding${plan.length === 1 ? '' : 's'}`}
      </button>
      <p className="muted small">Units and cost come from the statement. New SIP instalments show up when you import a newer CAS; prices update every morning either way.</p>
    </div>
  )
}
