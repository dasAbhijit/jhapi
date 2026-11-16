import type { ISODate } from '../dates'
import type { Paise } from '../money'

/** One email as the Apps Script puts it in the Inbox sheet (or as a test fixture). */
export interface EmailInput {
  from: string
  subject: string
  /** When Gmail received it, ISO 8601 (used when the body has no date). */
  receivedAt: string
  /** Plain text of the body. HTML converted to text if there was no plain part. */
  text: string
}

export type Institution = 'axis' | 'icici' | 'sbi' | 'dbs' | 'phonepe' | 'amazonpay' | 'cred'

export type AccountKind = 'bank' | 'credit_card' | 'wallet' | 'fastag'

export interface AccountRef {
  institution: Institution
  kind: AccountKind
  /**
   * Trailing digits as the email shows them (usually 4, sometimes 2 or 3, e.g. ICICI "XX555").
   * Match accounts by suffix. null when the email does not say which account (e.g. Axis outward NEFT).
   */
  last4: string | null
}

export type Channel =
  | 'upi'
  | 'neft'
  | 'rtgs'
  | 'imps'
  | 'ach'
  | 'ecs'
  | 'card'
  | 'atm'
  | 'pos'
  | 'interest'
  | 'fee'
  | 'transfer'
  | 'card_payment'
  | 'refund'
  | 'standing_instruction'
  | 'bill_payment'
  | 'toll'
  | 'wallet'
  | 'other'

export interface ParsedTxn {
  kind: 'txn'
  /** Which template matched, e.g. "axis.upi". Lets the review screen and tests say what was recognised. */
  template: string
  account: AccountRef
  direction: 'debit' | 'credit'
  amountPaise: Paise
  date: ISODate
  /** HH:MM or HH:MM:SS, India time, when the email gives it. */
  time?: string
  channel: Channel
  /** Merchant, payee, payer or the bank's narration. */
  counterparty?: string
  /** UPI RRN, NEFT UTR, order or transaction id. The key for spotting duplicates. */
  reference?: string
  /** Account balance after the transaction, when the email gives it. */
  balancePaise?: Paise
  /** Credit card available limit after the transaction. */
  availableLimitPaise?: Paise
  /** The owner's other account on the far side (own transfers, card bill payments). */
  counterAccount?: AccountRef
  /**
   * 'primary': the bank or card issuer's own alert, which moves the balance.
   * 'secondary': another email about the same money (PhonePe receipt, a second DBS email, a standing
   * instruction note). Used to add detail to the primary one, never counted twice.
   */
  role: 'primary' | 'secondary'
}

export interface ParsedStatement {
  kind: 'statement'
  template: string
  account: AccountRef
  totalDuePaise: Paise
  minDuePaise?: Paise
  dueDate: ISODate
}

export interface Ignored {
  kind: 'ignore'
  reason: string
}

export interface Unparsed {
  kind: 'unparsed'
  reason: string
}

export type ParseResult = ParsedTxn | ParsedStatement | Ignored | Unparsed
