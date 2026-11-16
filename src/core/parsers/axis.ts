/**
 * Axis Bank: alerts@axis.bank.in (alerts@axisbank.com until about Jan 2026), AxisBank.Alerts@ for
 * outward NEFT, cc.statements@ for card statements.
 */
import type { Channel, EmailInput, ParseResult, ParsedTxn } from './types'
import { AMT, DATE_NUM, DATE_WORDS, TIME, amountToPaise, clean, looseDate, tail } from './text'

const IGNORE_SUBJECTS = [
  /locker operation/i,
  /value your feedback/i,
  /maintenance intimation/i,
  /payee added/i,
  /interest in mutual funds/i,
  /log ?in.*could not be processed/i,
  /\bOTP\b/i,
  /important update/i,
  /statement\s*:\s*money quotient/i, // bank statement: figures only in the PDF
  /arise family/i,
]

/** Channel, reference and counterparty from Axis narrations such as UPI/P2M/<rrn>/<name>, NEFT/<utr>/<name>, ACH-CR-<co>. */
export function readNarration(info: string): { channel: Channel; reference?: string; counterparty?: string } {
  const parts = info.split('/')
  const head = parts[0].toUpperCase()
  if (head === 'UPI' || head === 'IMPS') {
    // UPI/P2M/<rrn>/<name>[/<bank>/<note>]
    return { channel: head === 'UPI' ? 'upi' : 'imps', reference: parts[2], counterparty: clean(parts[3]) }
  }
  if (head === 'NEFT' || head === 'RTGS') {
    return { channel: head === 'NEFT' ? 'neft' : 'rtgs', reference: parts[1], counterparty: clean(parts[2]) }
  }
  if (/^ACH-(CR|DR)-/i.test(info)) return { channel: 'ach', counterparty: clean(info.replace(/^ACH-(CR|DR)-/i, '')) }
  if (head === 'ECS') return { channel: 'ecs', reference: parts[1], counterparty: 'ECS' }
  return { channel: 'other', counterparty: clean(info) }
}

function txn(p: Omit<ParsedTxn, 'kind' | 'role'> & { role?: ParsedTxn['role'] }): ParsedTxn {
  return { kind: 'txn', role: 'primary', ...p }
}

export function parseAxis(email: EmailInput, t: string): ParseResult {
  const s = email.subject.trim()
  if (IGNORE_SUBJECTS.some((r) => r.test(s))) return { kind: 'ignore', reason: 'Axis notice, not a transaction' }

  // 1. UPI alert (2025 onward): "INR 21.00 was debited from your A/c no. XX1111." / "... was credited to your A/c."
  if (/^INR [\d,.]+ was (debited|credited)/i.test(s)) {
    const m = new RegExp(
      String.raw`Amount (Debited|Credited): INR ${AMT} Account Number: XX(\d+) Date & Time: ${DATE_NUM}, ${TIME} IST Transaction Info: (.+?)(?: If this transaction| Feel free| Always open|$)`,
      'i',
    ).exec(t)
    if (!m) return { kind: 'unparsed', reason: 'Axis UPI alert layout not recognised' }
    const n = readNarration(m[6].trim())
    return txn({
      template: 'axis.upi',
      account: { institution: 'axis', kind: 'bank', last4: tail(m[3]) },
      direction: m[1].toLowerCase() === 'debited' ? 'debit' : 'credit',
      amountPaise: amountToPaise(m[2])!,
      date: looseDate(m[4])!,
      time: m[5],
      ...n,
    })
  }

  // 2. Account debit/credit (NEFT, RTGS, ACH, ECS, salary, dividends)
  if (/^(Credit|Debit) transaction alert for Axis Bank A\/c/i.test(s)) {
    const m = new RegExp(
      String.raw`A/c no\. XX(\d+) has been (credited|debited) with INR ${AMT} on ${DATE_NUM}(?: at)? ${TIME} IST by (.+?)\.? To check`,
      'i',
    ).exec(t)
    if (!m) return { kind: 'unparsed', reason: 'Axis account alert layout not recognised' }
    return txn({
      template: 'axis.account',
      account: { institution: 'axis', kind: 'bank', last4: tail(m[1]) },
      direction: m[2].toLowerCase() === 'debited' ? 'debit' : 'credit',
      amountPaise: amountToPaise(m[3])!,
      date: looseDate(m[4])!,
      time: m[5],
      ...readNarration(m[6].trim()),
    })
  }

  // 3. Debit card: ATM withdrawal or card purchase
  if (/^Notification from Axis Bank/i.test(s)) {
    const m = new RegExp(
      String.raw`INR ${AMT} has been debited from your A/c no\. XX(\d+) on ${DATE_NUM} ${TIME} at (ATM-WDL|PUR)/(.+?)\. Available balance: INR ${AMT}`,
      'i',
    ).exec(t)
    if (!m) return { kind: 'unparsed', reason: 'Axis debit card alert layout not recognised' }
    const parts = m[6].split('/')
    const atm = m[5].toUpperCase() === 'ATM-WDL'
    return txn({
      template: atm ? 'axis.atm' : 'axis.debit_card',
      account: { institution: 'axis', kind: 'bank', last4: tail(m[2]) },
      direction: 'debit',
      amountPaise: amountToPaise(m[1])!,
      date: looseDate(m[3])!,
      time: m[4],
      channel: atm ? 'atm' : 'pos',
      counterparty: atm ? 'ATM withdrawal' : clean(parts[0]),
      reference: parts[parts.length - 1],
      balancePaise: amountToPaise(m[7])!,
    })
  }

  // 4. Older credit/debit notification (IMPS credits; UPI before 2025)
  if (/^(Credit|Debit) notification from Axis Bank/i.test(s)) {
    const m = new RegExp(
      String.raw`INR ${AMT} has been (credited|debited) (?:to|from) A/c no\. XX(\d+) on ${DATE_NUM} at ${TIME} IST\.? (?:Reference no\. - |Info- )(.+?)\.?(?= For any| To immediately|$)`,
      'i',
    ).exec(t)
    if (!m) return { kind: 'unparsed', reason: 'Axis notification layout not recognised' }
    return txn({
      template: 'axis.notification',
      account: { institution: 'axis', kind: 'bank', last4: tail(m[3]) },
      direction: m[2].toLowerCase() === 'debited' ? 'debit' : 'credit',
      amountPaise: amountToPaise(m[1])!,
      date: looseDate(m[4])!,
      time: m[5],
      ...readNarration(m[6].trim()),
    })
  }

  // 5. Credit card spend, older layout: "INR 24098 spent on credit card no. XX3333"
  if (/^INR [\d,.]+ spent on credit card no\./i.test(s)) {
    const m = new RegExp(
      String.raw`Transaction Amount: INR ${AMT} Merchant Name: (.+?) Axis Bank Credit Card No\. XX(\d+) Date & Time: ${DATE_NUM}, ${TIME} IST Available Limit\*?: INR ${AMT}`,
      'i',
    ).exec(t)
    if (!m) return { kind: 'unparsed', reason: 'Axis card alert layout not recognised' }
    return txn({
      template: 'axis.card',
      account: { institution: 'axis', kind: 'credit_card', last4: tail(m[3]) },
      direction: 'debit',
      amountPaise: amountToPaise(m[1])!,
      date: looseDate(m[4])!,
      time: m[5],
      channel: 'card',
      counterparty: clean(m[2]),
      availableLimitPaise: amountToPaise(m[6])!,
    })
  }

  // 6. Credit card spend, newer layout (Nov 2026)
  if (/^Transaction alert on Axis Bank Credit Card/i.test(s)) {
    const m = new RegExp(
      String.raw`Transaction amount \(INR\): INR ${AMT} Merchant name: (.+?) Axis Bank Credit Card No\.: XX(\d+) Date and time: ${DATE_NUM},? ${TIME} IST Available limit \(INR\): (?:INR )?${AMT}`,
      'i',
    ).exec(t)
    if (!m) return { kind: 'unparsed', reason: 'Axis card alert layout not recognised' }
    return txn({
      template: 'axis.card',
      account: { institution: 'axis', kind: 'credit_card', last4: tail(m[3]) },
      direction: 'debit',
      amountPaise: amountToPaise(m[1])!,
      date: looseDate(m[4])!,
      time: m[5],
      channel: 'card',
      counterparty: clean(m[2]),
      availableLimitPaise: amountToPaise(m[6])!,
    })
  }

  // 7. Outward NEFT/RTGS done from net banking. The email does not say which account paid.
  if (/^Your NEFT\/RTGS transaction is successful/i.test(s)) {
    const m = new RegExp(
      String.raw`Your (NEFT|RTGS) (?:transaction|Txn\.) with (?:reference no\.|Ref\. no) (\S+) for (?:INR|Rs\.) ${AMT} has been (?:successfully )?credited to (?:the )?beneficiary : (.+?)(?:, A/c no\. \S+)? on ${DATE_WORDS} at ${TIME}`,
      'i',
    ).exec(t)
    if (!m) return { kind: 'unparsed', reason: 'Axis NEFT confirmation layout not recognised' }
    return txn({
      template: 'axis.neft_out',
      account: { institution: 'axis', kind: 'bank', last4: null },
      direction: 'debit',
      amountPaise: amountToPaise(m[3])!,
      date: looseDate(m[5])!,
      time: m[6],
      channel: m[1].toUpperCase() === 'NEFT' ? 'neft' : 'rtgs',
      counterparty: clean(m[4]),
      reference: m[2],
    })
  }

  // 8. Credit card statement: "... Credit Card Statement ending XX82 - August 2026"
  const st = /Credit Card Statement ending XX(\d+)/i.exec(s)
  if (st) {
    const m = new RegExp(String.raw`${AMT} Dr ${AMT} Dr ${DATE_NUM}`).exec(t)
    if (!m) return { kind: 'unparsed', reason: 'Axis statement amounts not found' }
    return {
      kind: 'statement',
      template: 'axis.card_statement',
      account: { institution: 'axis', kind: 'credit_card', last4: st[1] },
      totalDuePaise: amountToPaise(m[1])!,
      minDuePaise: amountToPaise(m[2])!,
      dueDate: looseDate(m[3])!,
    }
  }

  return { kind: 'unparsed', reason: 'Unknown Axis email' }
}
