/**
 * A small fake of the Google Apps Script services, enough to run the built cloud/Code.gs in Node.
 * Sheets are plain 2-D arrays; Gmail is a list of fake messages.
 */
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'

type Cell = string | number | boolean | Date | null

export interface FakeMessage {
  id: string
  from: string
  subject: string
  date: string // ISO
  body: string
  /** Authentication-Results line Gmail would add; omit for "no header". */
  auth?: string
}

export function makeSheet(name: string, events: string[]) {
  const s = {
    name,
    grid: [] as Cell[][],
    formats: {} as Record<string, string>,
    frozen: 0,
    maxRows: 1000,
    maxCols: 26,
    getName: () => name,
    getLastRow: () => {
      let n = s.grid.length
      while (n > 0 && (s.grid[n - 1] ?? []).every((c) => c === '' || c === null || c === undefined)) n--
      return n
    },
    getLastColumn: () => Math.max(0, ...s.grid.map((r) => r.length)),
    getMaxRows: () => s.maxRows,
    getMaxColumns: () => s.maxCols,
    insertRowsAfter: (_: number, n: number) => { s.maxRows += n },
    clearContents: () => { s.grid = [] },
    insertColumnsAfter: (_: number, n: number) => { s.maxCols += n },
    setFrozenRows: (n: number) => { s.frozen = n },
    deleteRows: (start: number, n: number) => { s.grid.splice(start - 1, n) },
    getDataRange: () => s.getRange(1, 1, Math.max(1, s.getLastRow()), Math.max(1, s.getLastColumn())),
    getRange: (r: number, c: number, nr = 1, nc = 1) => {
      const range = {
        getSheet: () => s,
        getRow: () => r,
        getColumn: () => c,
        getNumRows: () => nr,
        getNumColumns: () => nc,
        getValues: () =>
          Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => {
            const v = s.grid[r - 1 + i]?.[c - 1 + j]
            return v === undefined || v === null ? '' : v
          })),
        setValues: (v: Cell[][]) => {
          events.push(`${name}:values`)
          v.forEach((row, i) => {
            s.grid[r - 1 + i] = s.grid[r - 1 + i] ?? []
            row.forEach((x, j) => { s.grid[r - 1 + i][c - 1 + j] = x })
          })
          return range
        },
        setValue: (x: Cell) => range.setValues([[x]]),
        setNumberFormat: (f: string) => {
          for (let i = 0; i < nr; i++) for (let j = 0; j < nc; j++) s.formats[`${r + i},${c + j}`] = f
          return range
        },
        setFontWeight: () => range,
      }
      return range
    },
  }
  return s
}

export function makeEnv(opts: { token?: string } = {}) {
  const events: string[] = []
  const sheets: Record<string, ReturnType<typeof makeSheet>> = {}
  const props: Record<string, string> = {}
  if (opts.token) props.JHAPI_TOKEN = opts.token
  const triggers: string[] = []
  const logs: string[] = []
  const messages: FakeMessage[] = []
  const queries: string[] = []
  const clock = { t: Date.parse('2026-11-17T10:00:00Z') }
  /** What the fake web returns, by URL; and what GOOGLEFINANCE returns, by symbol. */
  const web: Record<string, { code: number; body: string }> = {}
  const quotes: Record<string, number> = {}
  const fetched: string[] = []

  const ss = {
    getName: () => 'Jhapi',
    getSheetByName: (n: string) => sheets[n] ?? null,
    insertSheet: (n: string) => (sheets[n] = makeSheet(n, events)),
  }

  const toMessage = (m: FakeMessage) => ({
    getId: () => m.id,
    getFrom: () => m.from,
    getSubject: () => m.subject,
    getDate: () => new Date(m.date),
    getPlainBody: () => m.body,
    getBody: () => m.body,
    getRawContent: () =>
      `Delivered-To: owner@example.com\r\n${m.auth === undefined ? '' : `Authentication-Results: ${m.auth}\r\n`}From: ${m.from}\r\nSubject: ${m.subject}\r\n\r\n${m.body}`,
  })

  const ctx: Record<string, unknown> = {
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      // Formulas are worked out on flush: only =GOOGLEFINANCE("SYM","price") is understood.
      flush: () => {
        for (const sh of Object.values(sheets)) {
          sh.grid = sh.grid.map((row) => row.map((c) => {
            const m = typeof c === 'string' ? /^=GOOGLEFINANCE\("([^"]+)","price"\)$/.exec(c) : null
            return m ? (m[1] in quotes ? quotes[m[1]] : '#N/A') : c
          }))
        }
      },
      getUi: () => { throw new Error('No UI when run from a trigger or a test') },
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k: string) => (k in props ? props[k] : null),
        setProperty: (k: string, v: string) => { props[k] = String(v) },
      }),
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.map((h) => ({ getHandlerFunction: () => h })),
      newTrigger: (h: string) => {
        const b = { timeBased: () => b, everyMinutes: () => b, everyDays: () => b, atHour: () => b, create: () => { triggers.push(h) } }
        return b
      },
    },
    GmailApp: {
      search: (q: string, start: number, max: number) => {
        queries.push(q)
        const after = Number(/after:(\d+)/.exec(q)?.[1] ?? 0) * 1000
        // One thread per subject, like Gmail's grouping of identical alerts.
        const bySubject = new Map<string, FakeMessage[]>()
        for (const m of messages) {
          if (Date.parse(m.date) < after - 86_400_000) continue
          bySubject.set(m.subject, [...(bySubject.get(m.subject) ?? []), m])
        }
        return [...bySubject.values()].slice(start, start + max).map((ms) => ({ getMessages: () => ms.map(toMessage) }))
      },
    },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock: () => true, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text: string) => ({ text, setMimeType() { return this } }) },
    Utilities: { getUuid: () => randomUUID() },
    UrlFetchApp: {
      fetch: (url: string) => {
        fetched.push(url)
        const r = web[url] ?? { code: 404, body: '' }
        return { getResponseCode: () => r.code, getContentText: () => r.body }
      },
    },
    Logger: { log: (m: string) => logs.push(m) },
  }
  vm.createContext(ctx)
  vm.runInContext(readFileSync(join(__dirname, '../../cloud/Code.gs'), 'utf8'), ctx)
  ctx.nowMs_ = () => clock.t

  const fn = (name: string) => ctx[name] as (...a: unknown[]) => unknown
  const call = (body: unknown) =>
    JSON.parse((fn('doPost')({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }) as { text: string }).text)
  const tab = (name: string) => sheets[name]?.grid.filter((r) => r.some((c) => c !== '' && c !== null)) ?? []

  return { ctx, fn, call, sheets, tab, props, triggers, logs, messages, queries, clock, events, web, quotes, fetched }
}

/** An Authentication-Results line as Gmail writes it. */
export const passAuth = (domain: string) =>
  `mx.google.com; dkim=pass header.i=@${domain} header.s=s1 header.b=abc; spf=pass smtp.mailfrom=${domain}; dmarc=pass (p=REJECT) header.from=${domain}`
