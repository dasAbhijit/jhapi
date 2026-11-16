/**
 * Records as the app and the sheet both see them, and the rules for turning parsed emails into them.
 * This file is bundled into the Apps Script (cloud/Code.gs), so the app and the script share one
 * tested copy. Keep it free of browser and Node APIs.
 */
import type { ISODate } from './dates'
import type { Paise } from './money'
import type { AccountRef, ParsedStatement, ParsedTxn } from './parsers/types'

export type TxnStatus = 'verified' | 'manual' | 'receipt' | 'review' | 'ignored'
export type TxnSource = 'email' | 'app' | 'sheet'

export interface Txn {
  id: string
  date: ISODate
  time: string
  /** Account key, e.g. "axis-bank-1111", "icici-credit_card-4444", "amazonpay-wallet". */
  account: string
  direction: 'debit' | 'credit'
  amountPaise: Paise
  counterparty: string
  category: string
  channel: string
  reference: string
  /** Balance after the transaction, when the bank gave it; null otherwise. */
  balancePaise: Paise | null
  status: TxnStatus
  source: TxnSource
  note: string
  emailId: string
  template: string
  /** ISO timestamp of the last change, used to decide which side wins when both changed. */
  updatedAt: string
  deleted: boolean
}

export interface ReviewItem {
  id: string
  receivedAt: string
  from: string
  subject: string
  status: 'unparsed' | 'blocked'
  reason: string
  text: string
  emailId: string
  updatedAt: string
  resolved: boolean
}

export interface Statement {
  id: string
  account: string
  totalDuePaise: Paise
  minDuePaise: Paise | null
  dueDate: ISODate
  emailId: string
  updatedAt: string
}

export function accountKey(a: AccountRef): string {
  return [a.institution, a.kind, a.last4].filter((x) => x !== null && x !== '').join('-')
}

const INSTITUTION_NAMES: Record<string, string> = {
  axis: 'Axis', icici: 'ICICI', sbi: 'SBI', dbs: 'DBS', phonepe: 'PhonePe', amazonpay: 'Amazon Pay', cred: 'CRED',
}
const KIND_NAMES: Record<string, string> = { bank: 'Bank', credit_card: 'Card', wallet: 'Wallet', fastag: 'FASTag' }

/** "axis-bank-1111" → "Axis Bank ••1111". Unknown keys are shown as typed. */
export function accountLabel(key: string): string {
  const [inst, kind, last] = key.split('-')
  if (!INSTITUTION_NAMES[inst]) return key
  return [INSTITUTION_NAMES[inst], KIND_NAMES[kind] ?? kind, last ? `••${last}` : ''].filter(Boolean).join(' ')
}

/** Seed rules: first match wins. The owner's own rules (later) are checked before these. */
const CATEGORY_RULES: [RegExp, string][] = [
  [/swiggy|zomato|restaurant|cafe|food|dominos|pizza|eatery|bakery/i, 'Food'],
  [/amazon|flipkart|myntra|ajio|nykaa|meesho|store|mart|retail/i, 'Shopping'],
  [/bigbasket|blinkit|zepto|instamart|grocer|dmart|supermarket/i, 'Groceries'],
  [/uber|ola|rapido|metro|irctc|railway|indigo|air ?india|vistara|travel|toll|fastag|petrol|fuel|hpcl|bpcl|iocl/i, 'Transport'],
  [/electric|bescom|cesc|wbsedcl|power|water|gas|bsnl|jio|airtel|vodafone|vi |broadband|mobile|dth|utility/i, 'Bills'],
  [/insurance|lic\b|max life|hdfc life|icici pru|star health/i, 'Insurance'],
  [/zerodha|groww|clearing corp|mutual fund|\bmf\b|sip|coin|kfin|cams|nps|ppf/i, 'Investments'],
  [/hospital|pharma|medic|apollo|clinic|health|lab/i, 'Health'],
  [/rent|landlord|maintenance|society/i, 'Home'],
  [/netflix|prime video|hotstar|spotify|youtube|cinema|pvr|inox|bookmyshow/i, 'Entertainment'],
]

export function guessCategory(t: Pick<ParsedTxn, 'channel' | 'direction' | 'counterparty' | 'counterAccount'>): string {
  if (t.counterAccount || t.channel === 'card_payment' || t.channel === 'transfer') return 'Transfer'
  if (t.channel === 'interest') return 'Interest'
  if (t.channel === 'fee') return 'Fees'
  if (t.channel === 'atm') return 'Cash'
  if (t.channel === 'toll') return 'Transport'
  if (t.channel === 'refund') return 'Refund'
  if (t.channel === 'ach' && t.direction === 'credit') return 'Dividend'
  const name = t.counterparty ?? ''
  for (const [re, cat] of CATEGORY_RULES) if (re.test(name)) return cat
  return t.direction === 'credit' ? 'Income' : 'Other'
}

export function txnFromParsed(p: ParsedTxn, ids: { id: string; emailId: string; now: string }): Txn {
  return {
    id: ids.id,
    date: p.date,
    time: p.time ?? '',
    account: accountKey(p.account),
    direction: p.direction,
    amountPaise: p.amountPaise,
    counterparty: p.counterparty ?? '',
    category: guessCategory(p),
    channel: p.channel,
    reference: p.reference ?? '',
    balancePaise: p.balancePaise ?? null,
    status: p.role === 'secondary' ? 'receipt' : 'verified',
    source: 'email',
    note: p.counterAccount ? `To ${accountLabel(accountKey(p.counterAccount))}` : '',
    emailId: ids.emailId,
    template: p.template,
    updatedAt: ids.now,
    deleted: false,
  }
}

export function statementFromParsed(p: ParsedStatement, ids: { id: string; emailId: string; now: string }): Statement {
  return {
    id: ids.id,
    account: accountKey(p.account),
    totalDuePaise: p.totalDuePaise,
    minDuePaise: p.minDuePaise ?? null,
    dueDate: p.dueDate,
    emailId: ids.emailId,
    updatedAt: ids.now,
  }
}

/** True if this transaction counts towards balances and spending. */
export function counts(t: Txn): boolean {
  return !t.deleted && (t.status === 'verified' || t.status === 'manual')
}

/**
 * Is `incoming` the same money as something already stored? Same account, direction, amount and
 * a non-empty reference. (Same email id is checked separately, before parsing.)
 */
export function isDuplicate(incoming: Txn, existing: Txn[]): boolean {
  if (!incoming.reference) return false
  return existing.some(
    (e) =>
      !e.deleted &&
      e.status === incoming.status &&
      e.reference === incoming.reference &&
      e.account === incoming.account &&
      e.direction === incoming.direction &&
      e.amountPaise === incoming.amountPaise,
  )
}

/**
 * Record-level merge used for both directions. For each id the newer `updatedAt` wins; ties keep the
 * stored copy. Returns the merged list and which incoming records lost (the sheet had a newer edit).
 */
export function mergeById<T extends { id: string; updatedAt: string }>(stored: T[], incoming: T[]): { merged: T[]; rejected: string[] } {
  const byId = new Map(stored.map((r) => [r.id, r]))
  const rejected: string[] = []
  for (const r of incoming) {
    const cur = byId.get(r.id)
    if (!cur || r.updatedAt > cur.updatedAt) byId.set(r.id, r)
    else if (r.updatedAt < cur.updatedAt) rejected.push(r.id)
  }
  return { merged: [...byId.values()], rejected }
}
