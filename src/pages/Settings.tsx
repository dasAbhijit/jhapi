import { useState, type FormEvent } from 'react'
import { useStore } from '../data/storeContext'

const GUIDE = 'https://github.com/dasAbhijit/jhapi/blob/main/docs/admin/setup.md'

export default function Settings() {
  const { config, connect, disconnect, data, sync, syncing, readInbox, readingInbox, error, saveRule } = useStore()
  const rules = (data?.rules ?? []).filter((r) => !r.deleted)
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setErr(null)
    setBusy(true)
    try {
      await connect(url, token)
      setUrl('')
      setToken('')
    } catch (x) {
      setErr((x as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const fmt = (iso: string) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'not yet')

  return (
    <div className="page">
      <h1>Settings</h1>
      <section className="card stack">
        <h2>Your Jhapi sheet</h2>
        {config ? (
          <>
            <p className="muted">
              Connected. Bank emails are read by the sheet's script every 10 minutes, and this app pulls the sheet every time it opens.
            </p>
            <ul className="plain">
              <li className="kv"><span>Last synced</span><strong>{fmt(data?.pulledAt ?? '')}</strong></li>
              <li className="kv"><span>Bank emails last read</span><strong>{fmt(data?.lastInboxRun ?? '')}</strong></li>
              <li className="kv"><span>Transactions in the sheet</span><strong>{data?.transactions.length ?? 0}</strong></li>
            </ul>
            {error && <p className="banner err" role="alert">{error}</p>}
            {(data?.problems.length ?? 0) > 0 && (
              <details>
                <summary>{data!.problems.length} row(s) in the sheet could not be read</summary>
                <ul>{data!.problems.map((p) => <li key={p}>{p}</li>)}</ul>
              </details>
            )}
            <div className="btn-row">
              <button type="button" className="btn" disabled={syncing} onClick={() => void sync()}>{syncing ? 'Syncing…' : 'Sync now'}</button>
              <button type="button" className="btn" disabled={readingInbox} onClick={() => void readInbox()}>{readingInbox ? 'Reading…' : 'Read bank emails now'}</button>
            </div>
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                if (window.confirm('Disconnect this device? The sheet keeps all data; this device forgets the address and code.')) disconnect()
              }}
            >
              Disconnect this device
            </button>
          </>
        ) : (
          <form className="stack" onSubmit={submit}>
            <p className="muted">
              Paste the web app URL and secret code from your Jhapi sheet. First time? Follow the <a href={GUIDE} target="_blank" rel="noreferrer">setup guide</a> (about 10 minutes on a laptop).
            </p>
            <label className="field">
              <span>Web app URL</span>
              <input className="input" type="url" inputMode="url" autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="https://script.google.com/macros/s/…/exec" value={url} onChange={(e) => setUrl(e.target.value)} required />
            </label>
            <label className="field">
              <span>Secret code</span>
              <input className="input" type="password" autoCapitalize="off" autoCorrect="off" spellCheck={false} autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} required />
            </label>
            {err && <p className="banner err" role="alert">{err}</p>}
            <button type="submit" className="btn primary" disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button>
          </form>
        )}
      </section>
      {config && (
        <section className="card stack">
          <h2>Category rules</h2>
          <p className="muted">New bank emails whose payee contains the text get the category. Add one from any transaction (“Always use…”), or in the sheet's Rules tab.</p>
          {rules.length === 0 ? (
            <p className="muted">No rules yet.</p>
          ) : (
            <ul className="plain">
              {rules.map((r) => (
                <li key={r.id} className="kv">
                  <span>“{r.contains}” → <strong>{r.category}</strong></span>
                  <button type="button" className="link-btn" aria-label={`Remove rule for ${r.contains}`} onClick={() => saveRule({ ...r, deleted: true })}>Remove</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      <section className="card stack">
        <h2>Privacy</h2>
        <p className="muted">
          Your data lives in your own Google Sheet, in your Google account, and on this device. The sheet's script only reads emails from your banks' alert addresses and never changes your mail. Encryption on this device is planned.
        </p>
      </section>
    </div>
  )
}
