/**
 * How records are laid out in the Google Sheet, and how rows (including ones typed by hand) are read
 * back. Shared by the app and the Apps Script.
 *
 * The sheet is meant to be read and edited by a person: amounts are in rupees, dates are YYYY-MM-DD
 * text, and "Debit"/"Credit" are words. Hand-typed rows may use other date styles (16/11/2026) and
 * may leave ID, Status, Source and Updated empty; those are filled in.
 */
import { formatDate, parseDate } from './dates'
import { looseDate } from './parsers/text'
import type { ReviewItem, Statement, Txn, TxnSource, TxnStatus } from './records'

export type Cell = string | number | boolean | null

export const TXN_TAB = 'Transactions'
export const REVIEW_TAB = 'Review'
export const STATEMENT_TAB = 'Statements'
export const LOG_TAB = 'Log'

export const TXN_HEADERS = [
  'ID', 'Date', 'Time', 'Account', 'Type', 'Amount', 'Counterparty', 'Category', 'Channel', 'Reference',
  'Balance', 'Status', 'Source', 'Note', 'Email ID', 'Template', 'Updated', 'Deleted',
] as const
export const REVIEW_HEADERS = ['ID', 'Received', 'From', 'Subject', 'Status', 'Reason', 'Text', 'Email ID', 'Updated', 'Resolved'] as const
export const STATEMENT_HEADERS = ['ID', 'Account', 'Total due', 'Minimum due', 'Due date', 'Email ID', 'Updated'] as const

/** Columns that must stay plain text in the sheet, so Sheets does not turn them into dates or numbers. */
export const TEXT_COLUMNS: Record<string, readonly string[]> = {
  [TXN_TAB]: ['ID', 'Date', 'Time', 'Account', 'Reference', 'Email ID', 'Updated'],
  [REVIEW_TAB]: ['ID', 'Received', 'Email ID', 'Updated'],
  [STATEMENT_TAB]: ['ID', 'Account', 'Due date', 'Email ID', 'Updated'],
}

const STATUS_WORDS: Record<TxnStatus, string> = { verified: 'Verified', manual: 'Manual', receipt: 'Receipt', review: 'Review', ignored: 'Ignored' }
const SOURCE_WORDS: Record<TxnSource, string> = { email: 'Email', app: 'App', sheet: 'Sheet' }

const rupees = (p: number | null) => (p === null ? '' : Math.round(p) / 100)

function paiseFrom(c: Cell): number | null {
  if (c === null || c === '') return null
  const n = typeof c === 'number' ? c : Number(String(c).replace(/[₹,\s]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

function str(c: Cell): string {
  return c === null || c === undefined ? '' : String(c).trim()
}

function bool(c: Cell): boolean {
  return c === true || /^(true|yes|y|1|x)$/i.test(str(c))
}

/** Dates may arrive as YYYY-MM-DD text, other typed styles, or a Date object from Sheets. */
export function readDate(c: Cell | Date): string {
  // Not `instanceof`: the Apps Script and the tests can hand over Date objects from another realm.
  if (Object.prototype.toString.call(c) === '[object Date]') {
    const d = c as Date
    if (Number.isNaN(d.getTime())) return ''
    return formatDate({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() })
  }
  const s = str(c as Cell)
  if (!s) return ''
  try {
    return formatDate(parseDate(s))
  } catch {
    return looseDate(s) ?? ''
  }
}

export function txnToRow(t: Txn): Cell[] {
  return [
    t.id, t.date, t.time, t.account, t.direction === 'credit' ? 'Credit' : 'Debit', rupees(t.amountPaise), t.counterparty, t.category,
    t.channel, t.reference, rupees(t.balancePaise), STATUS_WORDS[t.status], SOURCE_WORDS[t.source], t.note, t.emailId, t.template,
    t.updatedAt, t.deleted ? 'TRUE' : '',
  ]
}

/**
 * A sheet row back to a record. Returns null for rows that are empty or have no usable amount/date,
 * and the list of problems so the Log can say what was skipped.
 */
export function rowToTxn(row: (Cell | Date)[], headers: string[]): { txn: Txn | null; problem?: string } {
  const get = (h: string) => row[headers.indexOf(h)] as Cell
  if (row.every((c) => c === '' || c === null)) return { txn: null }
  const date = readDate(row[headers.indexOf('Date')])
  const amount = paiseFrom(get('Amount'))
  if (!date) return { txn: null, problem: 'missing or unreadable Date' }
  if (amount === null || amount <= 0) return { txn: null, problem: 'missing or unreadable Amount' }
  const type = str(get('Type')).toLowerCase()
  const status = (Object.keys(STATUS_WORDS) as TxnStatus[]).find((k) => STATUS_WORDS[k].toLowerCase() === str(get('Status')).toLowerCase())
  const source = (Object.keys(SOURCE_WORDS) as TxnSource[]).find((k) => SOURCE_WORDS[k].toLowerCase() === str(get('Source')).toLowerCase())
  return {
    txn: {
      id: str(get('ID')),
      date,
      time: str(get('Time')),
      account: str(get('Account')),
      direction: type.startsWith('c') ? 'credit' : 'debit',
      amountPaise: amount,
      counterparty: str(get('Counterparty')),
      category: str(get('Category')) || 'Other',
      channel: str(get('Channel')),
      reference: str(get('Reference')),
      balancePaise: paiseFrom(get('Balance')),
      status: status ?? 'manual',
      source: source ?? 'sheet',
      note: str(get('Note')),
      emailId: str(get('Email ID')),
      template: str(get('Template')),
      updatedAt: str(get('Updated')),
      deleted: bool(get('Deleted')),
    },
  }
}

export function reviewToRow(r: ReviewItem): Cell[] {
  return [r.id, r.receivedAt, r.from, r.subject, r.status === 'blocked' ? 'Blocked' : 'Not parsed', r.reason, r.text, r.emailId, r.updatedAt, r.resolved ? 'TRUE' : '']
}

export function rowToReview(row: Cell[], headers: string[]): ReviewItem | null {
  const get = (h: string) => row[headers.indexOf(h)] as Cell
  if (!str(get('ID')) && !str(get('Email ID'))) return null
  return {
    id: str(get('ID')),
    receivedAt: str(get('Received')),
    from: str(get('From')),
    subject: str(get('Subject')),
    status: /block/i.test(str(get('Status'))) ? 'blocked' : 'unparsed',
    reason: str(get('Reason')),
    text: str(get('Text')),
    emailId: str(get('Email ID')),
    updatedAt: str(get('Updated')),
    resolved: bool(get('Resolved')),
  }
}

export function statementToRow(s: Statement): Cell[] {
  return [s.id, s.account, rupees(s.totalDuePaise), rupees(s.minDuePaise), s.dueDate, s.emailId, s.updatedAt]
}

export function rowToStatement(row: (Cell | Date)[], headers: string[]): Statement | null {
  const get = (h: string) => row[headers.indexOf(h)] as Cell
  const total = paiseFrom(get('Total due'))
  const due = readDate(row[headers.indexOf('Due date')])
  if (!str(get('ID')) || total === null || !due) return null
  return {
    id: str(get('ID')),
    account: str(get('Account')),
    totalDuePaise: total,
    minDuePaise: paiseFrom(get('Minimum due')),
    dueDate: due,
    emailId: str(get('Email ID')),
    updatedAt: str(get('Updated')),
  }
}
