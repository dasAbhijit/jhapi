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
import type { ReviewItem, Rule, Statement, Txn, TxnSource, TxnStatus } from './records'
import { HOLDING_TYPES, type Holding, type HoldingType } from './holdings'
import type { Snapshot as NetWorthSnapshot } from './networth'
import { readTags, writeTags, type Goal } from './goalPlan'

export type Cell = string | number | boolean | null

export const TXN_TAB = 'Transactions'
export const REVIEW_TAB = 'Review'
export const STATEMENT_TAB = 'Statements'
export const LOG_TAB = 'Log'
export const RULES_TAB = 'Rules'

export const TXN_HEADERS = [
  'ID', 'Date', 'Time', 'Account', 'Type', 'Amount', 'Counterparty', 'Category', 'Channel', 'Reference',
  'Balance', 'Status', 'Source', 'Note', 'Email ID', 'Template', 'Updated', 'Deleted',
] as const
export const REVIEW_HEADERS = ['ID', 'Received', 'From', 'Subject', 'Status', 'Reason', 'Text', 'Email ID', 'Updated', 'Resolved'] as const
export const STATEMENT_HEADERS = ['ID', 'Account', 'Total due', 'Minimum due', 'Due date', 'Email ID', 'Updated'] as const
export const RULES_HEADERS = ['ID', 'Contains', 'Category', 'Updated', 'Deleted'] as const

/** Columns that must stay plain text in the sheet, so Sheets does not turn them into dates or numbers. */
export const TEXT_COLUMNS: Record<string, readonly string[]> = {
  [TXN_TAB]: ['ID', 'Date', 'Time', 'Account', 'Reference', 'Email ID', 'Updated'],
  [REVIEW_TAB]: ['ID', 'Received', 'Email ID', 'Updated'],
  [STATEMENT_TAB]: ['ID', 'Account', 'Due date', 'Email ID', 'Updated'],
  [RULES_TAB]: ['ID', 'Contains', 'Updated'],
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

export function ruleToRow(r: Rule): Cell[] {
  return [r.id, r.contains, r.category, r.updatedAt, r.deleted ? 'TRUE' : '']
}

export function rowToRule(row: Cell[], headers: string[]): Rule | null {
  const get = (h: string) => row[headers.indexOf(h)] as Cell
  const contains = str(get('Contains'))
  const category = str(get('Category'))
  if (!contains || !category) return null
  return { id: str(get('ID')), contains, category, updatedAt: str(get('Updated')), deleted: bool(get('Deleted')) }
}

// ---------- Holdings tab ----------

export const HOLDINGS_TAB = 'Holdings'
export const HOLDING_HEADERS = [
  'ID', 'Name', 'Type', 'Institution', 'Code', 'Units', 'Price', 'Price date', 'Invested', 'Value', 'Value date', 'Rate %',
  'Start', 'Maturity', 'Compounding', 'Payout', 'Monthly', 'Months', 'Notes', 'Updated', 'Deleted',
] as const
TEXT_COLUMNS[HOLDINGS_TAB] = ['ID', 'Code', 'Units', 'Price date', 'Value date', 'Start', 'Maturity', 'Updated']

const COMPOUNDING = ['monthly', 'quarterly', 'half-yearly', 'yearly']

export function holdingToRow(h: Holding): Cell[] {
  return [
    h.id, h.name, HOLDING_TYPES[h.type].label, h.institution, h.code, h.units, rupees(h.pricePaise), h.priceDate, rupees(h.investedPaise),
    rupees(h.valuePaise), h.valueDate, h.ratePct ?? '', h.startDate, h.maturityDate, h.compounding, h.payout ? 'TRUE' : '',
    rupees(h.monthlyPaise), h.tenureMonths ?? '', h.notes, h.updatedAt, h.deleted ? 'TRUE' : '',
  ]
}

/** Type cells may hold the label ("PPF", "Mutual fund") or the key ("ppf", "mf"). */
export function readHoldingType(c: Cell): HoldingType | null {
  const s = str(c).toLowerCase()
  const key = (Object.keys(HOLDING_TYPES) as HoldingType[]).find((k) => k === s || HOLDING_TYPES[k].label.toLowerCase() === s)
  return key ?? null
}

function num(c: Cell): number | null {
  if (c === null || c === '') return null
  const n = typeof c === 'number' ? c : Number(String(c).replace(/[%,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

export function rowToHolding(row: (Cell | Date)[], headers: string[]): { holding: Holding | null; problem?: string } {
  const get = (h: string) => row[headers.indexOf(h)] as Cell
  const raw = (h: string) => row[headers.indexOf(h)]
  if (row.every((c) => c === '' || c === null)) return { holding: null }
  const type = readHoldingType(get('Type'))
  if (!type) return { holding: null, problem: `unknown Type "${str(get('Type'))}"` }
  const comp = str(get('Compounding')).toLowerCase()
  const months = num(get('Months'))
  return {
    holding: {
      id: str(get('ID')),
      type,
      name: str(get('Name')) || HOLDING_TYPES[type].label,
      institution: str(get('Institution')),
      code: str(get('Code')),
      units: str(get('Units')),
      pricePaise: paiseFrom(get('Price')),
      priceDate: readDate(raw('Price date')),
      investedPaise: paiseFrom(get('Invested')),
      valuePaise: paiseFrom(get('Value')),
      valueDate: readDate(raw('Value date')),
      ratePct: num(get('Rate %')),
      startDate: readDate(raw('Start')),
      maturityDate: readDate(raw('Maturity')),
      compounding: (COMPOUNDING.includes(comp) ? comp : '') as Holding['compounding'],
      payout: bool(get('Payout')),
      monthlyPaise: paiseFrom(get('Monthly')),
      tenureMonths: months === null ? null : Math.round(months),
      notes: str(get('Notes')),
      updatedAt: str(get('Updated')),
      deleted: bool(get('Deleted')),
    },
  }
}

// ---------- Net worth tab (one row per day, written by the script) ----------

export const NETWORTH_TAB = 'Net worth'
export const NETWORTH_HEADERS = ['Date', 'Net worth', 'Holdings', 'Bank balances', 'Loans', 'Retirement', 'Market', 'Deposits', 'Gold & other'] as const
TEXT_COLUMNS[NETWORTH_TAB] = ['Date']

export function snapshotToRow(s: NetWorthSnapshot): Cell[] {
  return [s.date, rupees(s.netPaise), rupees(s.holdingsPaise), rupees(s.bankPaise), rupees(s.liabilitiesPaise),
    rupees(s.byClass.retirement), rupees(s.byClass.market), rupees(s.byClass.deposits), rupees(s.byClass.gold_other)]
}

export function rowToSnapshot(row: (Cell | Date)[], headers: string[]): NetWorthSnapshot | null {
  const get = (h: string) => paiseFrom(row[headers.indexOf(h)] as Cell) ?? 0
  const date = readDate(row[headers.indexOf('Date')])
  if (!date) return null
  return {
    date, netPaise: get('Net worth'), holdingsPaise: get('Holdings'), bankPaise: get('Bank balances'), liabilitiesPaise: get('Loans'),
    byClass: { retirement: get('Retirement'), market: get('Market'), deposits: get('Deposits'), gold_other: get('Gold & other') },
  }
}

// ---------- Goals tab ----------

export const GOALS_TAB = 'Goals'
export const GOAL_HEADERS = ['ID', 'Name', 'Cost today', 'Target year', 'Inflation %', 'Return %', 'Monthly SIP', 'Holdings', 'Notes', 'Updated', 'Deleted'] as const
TEXT_COLUMNS[GOALS_TAB] = ['ID', 'Holdings', 'Updated']

export function goalToRow(g: Goal): Cell[] {
  return [g.id, g.name, rupees(g.costTodayPaise), g.targetYear, g.inflationPct, g.returnPct ?? '', rupees(g.sipPaise), writeTags(g.tags), g.notes, g.updatedAt, g.deleted ? 'TRUE' : '']
}

export function rowToGoal(row: (Cell | Date)[], headers: string[]): { goal: Goal | null; problem?: string } {
  const get = (h: string) => row[headers.indexOf(h)] as Cell
  if (row.every((c) => c === '' || c === null)) return { goal: null }
  const cost = paiseFrom(get('Cost today'))
  const year = num(get('Target year'))
  if (cost === null || cost <= 0) return { goal: null, problem: 'missing Cost today' }
  if (year === null || year < 2000 || year > 2200) return { goal: null, problem: 'missing or unreadable Target year' }
  return {
    goal: {
      id: str(get('ID')),
      name: str(get('Name')) || 'Goal',
      costTodayPaise: cost,
      targetYear: Math.round(year),
      inflationPct: num(get('Inflation %')) ?? 6,
      returnPct: num(get('Return %')),
      sipPaise: paiseFrom(get('Monthly SIP')) ?? 0,
      tags: readTags(str(get('Holdings'))),
      notes: str(get('Notes')),
      updatedAt: str(get('Updated')),
      deleted: bool(get('Deleted')),
    },
  }
}
