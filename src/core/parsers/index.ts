/**
 * Entry point: decide which bank an email is from and parse it.
 *
 * Only allow-listed sender addresses are parsed. The sender check here is by address; the Apps Script
 * also checks the DKIM signature before an email reaches the app (DESIGN.md section 3.2).
 * Gmail's Promotions label is never used, because banks send real alerts there too.
 */
import { parseAxis } from './axis'
import { parseIcici } from './icici'
import { parseAmazonPay, parseCred, parseDbs, parsePhonePe, parseSbi } from './others'
import { flatten, senderAddress } from './text'
import type { EmailInput, Institution, ParseResult } from './types'

export type { EmailInput, ParseResult, ParsedTxn, ParsedStatement, AccountRef, Channel, Institution } from './types'

export interface Sender {
  /** Exact address, or `@domain` for any address at that domain. */
  match: string
  institution: Institution
  /** Domain that must sign the email (DKIM d=). The Apps Script checks this. */
  dkimDomain: string
}

/**
 * Allow-list. Old and new (.bank.in) domains are both listed while banks move over.
 * The Apps Script's Senders tab is generated from this list.
 */
export const SENDERS: Sender[] = [
  { match: 'alerts@axis.bank.in', institution: 'axis', dkimDomain: 'axis.bank.in' },
  { match: 'alerts@axisbank.com', institution: 'axis', dkimDomain: 'axisbank.com' },
  { match: 'axisbank.alerts@axis.bank.in', institution: 'axis', dkimDomain: 'axis.bank.in' },
  { match: 'cc.statements@axis.bank.in', institution: 'axis', dkimDomain: 'axis.bank.in' },
  { match: 'cc.statements@axisbank.com', institution: 'axis', dkimDomain: 'axisbank.com' },
  { match: 'credit_cards@icici.bank.in', institution: 'icici', dkimDomain: 'icici.bank.in' },
  { match: 'credit_cards@icicibank.com', institution: 'icici', dkimDomain: 'icicibank.com' },
  { match: 'cards@icici.bank.in', institution: 'icici', dkimDomain: 'icici.bank.in' },
  { match: 'services@icici.bank.in', institution: 'icici', dkimDomain: 'icici.bank.in' },
  { match: 'customernotification@icici.bank.in', institution: 'icici', dkimDomain: 'icici.bank.in' },
  { match: 'customercare@icicibank.com', institution: 'icici', dkimDomain: 'icicibank.com' },
  { match: 'cbsalerts.sbi@alerts.sbi.bank.in', institution: 'sbi', dkimDomain: 'alerts.sbi.bank.in' },
  { match: 'cbsalerts.sbi@alerts.sbi.co.in', institution: 'sbi', dkimDomain: 'alerts.sbi.co.in' },
  { match: 'yonosbi@alerts.sbi.bank.in', institution: 'sbi', dkimDomain: 'alerts.sbi.bank.in' },
  { match: 'yonosbi@alerts.sbi.co.in', institution: 'sbi', dkimDomain: 'alerts.sbi.co.in' },
  { match: 'digibankalerts@dbs.com', institution: 'dbs', dkimDomain: 'dbs.com' },
  { match: 'digibankconnect@dbs.com', institution: 'dbs', dkimDomain: 'dbs.com' },
  { match: 'noreply@phonepe.com', institution: 'phonepe', dkimDomain: 'phonepe.com' },
  { match: 'no-reply@amazonpay.in', institution: 'amazonpay', dkimDomain: 'amazonpay.in' },
  { match: 'protect@cred.club', institution: 'cred', dkimDomain: 'cred.club' },
]

export function findSender(from: string): Sender | null {
  const addr = senderAddress(from)
  return SENDERS.find((s) => (s.match.startsWith('@') ? addr.endsWith(s.match) : addr === s.match)) ?? null
}

const PARSERS: Record<Institution, (e: EmailInput, flat: string) => ParseResult> = {
  axis: parseAxis,
  icici: parseIcici,
  sbi: parseSbi,
  dbs: parseDbs,
  phonepe: parsePhonePe,
  amazonpay: parseAmazonPay,
  cred: parseCred,
}

export function parseEmail(email: EmailInput): ParseResult {
  const sender = findSender(email.from)
  if (!sender) return { kind: 'ignore', reason: 'Sender is not on the allow-list' }
  try {
    const result = PARSERS[sender.institution](email, flatten(email.text))
    // A template that matched but produced an impossible value is treated as not parsed.
    if (result.kind === 'txn' && (!result.date || !(result.amountPaise > 0))) {
      return { kind: 'unparsed', reason: `${result.template}: amount or date missing` }
    }
    return result
  } catch (e) {
    return { kind: 'unparsed', reason: `Parser error: ${(e as Error).message}` }
  }
}
