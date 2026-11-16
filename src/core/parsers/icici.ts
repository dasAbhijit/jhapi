/**
 * ICICI Bank: credit_cards@, cards@, services@, customernotification@, customercare@ at icici.bank.in
 * (icicibank.com before the move). The custcomm subdomains only send offers and are not on the allow-list.
 */
import type { EmailInput, ParseResult, ParsedTxn } from './types'
import { AMT, DATE_MON, DATE_NUM, DATE_WORDS, TIME, amountToPaise, clean, looseDate, tail } from './text'

const IGNORE_SUBJECTS = [
  /upcoming payment notification/i,
  /successful registration of standing instruction/i,
  /monthly average balance/i,
  /gst invoice/i,
  /^ICICI Bank Statement from/i, // savings statement: figures only in the PDF
  /travel card/i, // forex card: USD amounts, handled later
]

function txn(p: Omit<ParsedTxn, 'kind' | 'role'> & { role?: ParsedTxn['role'] }): ParsedTxn {
  return { kind: 'txn', role: 'primary', ...p }
}

export function parseIcici(email: EmailInput, t: string): ParseResult {
  const s = email.subject.trim()
  if (IGNORE_SUBJECTS.some((r) => r.test(s))) return { kind: 'ignore', reason: 'ICICI notice, not a transaction' }

  // Card spend
  if (/^Transaction alert for your ICICI Bank Credit Card/i.test(s)) {
    const m = new RegExp(
      String.raw`Credit Card XX(\d+) has been used for a transaction of INR ${AMT} on ${DATE_WORDS} at ${TIME}\. Info: (.+?)\. The Available Credit Limit on your card is INR ${AMT}`,
      'i',
    ).exec(t)
    if (!m) return { kind: 'unparsed', reason: 'ICICI card alert layout not recognised' }
    return txn({
      template: 'icici.card',
      account: { institution: 'icici', kind: 'credit_card', last4: tail(m[1]) },
      direction: 'debit',
      amountPaise: amountToPaise(m[2])!,
      date: looseDate(m[3])!,
      time: m[4],
      channel: 'card',
      counterparty: clean(m[5]),
      availableLimitPaise: amountToPaise(m[6])!,
    })
  }

  // Card bill paid
  if (/^Payment received on your ICICI Bank Credit Card/i.test(s)) {
    const m = new RegExp(String.raw`payment of INR ${AMT} on your ICICI Bank Credit Card account [\dX ]*?(\d{4}) on ${DATE_MON}`, 'i').exec(t)
    if (!m) return { kind: 'unparsed', reason: 'ICICI payment layout not recognised' }
    return txn({
      template: 'icici.card_payment',
      account: { institution: 'icici', kind: 'credit_card', last4: m[2] },
      direction: 'credit',
      amountPaise: amountToPaise(m[1])!,
      date: looseDate(m[3])!,
      channel: 'card_payment',
      counterparty: 'Card bill payment',
    })
  }

  // Reversal or merchant refund to the card
  if (/^Reversal processed on your ICICI Bank Credit Card/i.test(s)) {
    const m = new RegExp(String.raw`reversal of INR ${AMT} has been done on your ICICI Bank Credit Card XX(\d+) on ${DATE_WORDS}`, 'i').exec(t)
    if (!m) return { kind: 'unparsed', reason: 'ICICI reversal layout not recognised' }
    return txn({
      template: 'icici.card_reversal',
      account: { institution: 'icici', kind: 'credit_card', last4: tail(m[2]) },
      direction: 'credit',
      amountPaise: amountToPaise(m[1])!,
      date: looseDate(m[3])!,
      channel: 'refund',
      counterparty: 'Reversal',
    })
  }
  if (/^Merchant credit refund on your ICICI Bank Credit Card/i.test(s)) {
    const m = new RegExp(
      String.raw`refund on your ICICI Bank Credit Card XX(\d+) for INR ${AMT} on ${DATE_WORDS} from (.+?)\. We wish`,
      'i',
    ).exec(t)
    if (!m) return { kind: 'unparsed', reason: 'ICICI refund layout not recognised' }
    return txn({
      template: 'icici.card_refund',
      account: { institution: 'icici', kind: 'credit_card', last4: tail(m[1]) },
      direction: 'credit',
      amountPaise: amountToPaise(m[2])!,
      date: looseDate(m[3])!,
      channel: 'refund',
      counterparty: clean(m[4]),
    })
  }

  // Standing instruction charged to the card. The card alert also fires, so this one only adds detail.
  if (/^Transaction Success notification for Standing Instruction/i.test(s)) {
    const m = new RegExp(
      String.raw`payment of INR ${AMT} towards (.+?), with Standing Instruction (\S+), on ${DATE_NUM}, through your ICICI Bank Credit Card (\d{4})`,
      'i',
    ).exec(t)
    if (!m) return { kind: 'unparsed', reason: 'ICICI standing instruction layout not recognised' }
    return txn({
      template: 'icici.standing_instruction',
      role: 'secondary',
      account: { institution: 'icici', kind: 'credit_card', last4: m[5] },
      direction: 'debit',
      amountPaise: amountToPaise(m[1])!,
      date: looseDate(m[4])!,
      channel: 'standing_instruction',
      counterparty: clean(m[2]),
      reference: m[3],
    })
  }

  // Savings account: in practice only the quarterly interest credit
  if (/^Transaction alert for your ICICI Bank account/i.test(s)) {
    const m = new RegExp(String.raw`Account XX(\d+) has been (credited|debited) with INR ${AMT} on ${DATE_MON}\. Info: (.+?)\. NEVER`, 'i').exec(t)
    if (!m) return { kind: 'unparsed', reason: 'ICICI account alert layout not recognised' }
    const interest = /Int\.Pd/i.test(m[5])
    return txn({
      template: 'icici.account',
      account: { institution: 'icici', kind: 'bank', last4: tail(m[1]) },
      direction: m[2].toLowerCase() === 'debited' ? 'debit' : 'credit',
      amountPaise: amountToPaise(m[3])!,
      date: looseDate(m[4])!,
      channel: interest ? 'interest' : 'other',
      counterparty: interest ? 'Interest' : clean(m[5]),
    })
  }

  // iMobile payment from savings to the owner's own credit card
  if (/^Transaction alert for your ICICI Bank Mobile Banking/i.test(s)) {
    const m = new RegExp(
      String.raw`payment of ₹ ?${AMT} using iMobile towards X*(\d+) from your Account X*(\d+) ?\. The payment was initiated through Transaction ID : (\d+) on ${DATE_WORDS} at (\d{2}:\d{2}) hours`,
      'i',
    ).exec(t)
    if (!m) return { kind: 'unparsed', reason: 'ICICI iMobile layout not recognised' }
    return txn({
      template: 'icici.imobile',
      account: { institution: 'icici', kind: 'bank', last4: tail(m[3]) },
      counterAccount: { institution: 'icici', kind: 'credit_card', last4: tail(m[2]) },
      direction: 'debit',
      amountPaise: amountToPaise(m[1])!,
      date: looseDate(m[5])!,
      time: m[6],
      channel: 'transfer',
      counterparty: 'Credit card bill',
      reference: m[4],
    })
  }

  // FASTag toll
  if (/^ICICI Bank FASTag transaction alert/i.test(s)) {
    const m = new RegExp(
      String.raw`Vehicle No\. (\S+) has been debited with ${AMT} on ${DATE_NUM} at ${TIME} for (.+?)\. The available Balance is ${AMT}`,
      'i',
    ).exec(t)
    if (!m) return { kind: 'unparsed', reason: 'ICICI FASTag layout not recognised' }
    return txn({
      template: 'icici.fastag',
      account: { institution: 'icici', kind: 'fastag', last4: m[1].slice(-4) },
      direction: 'debit',
      amountPaise: amountToPaise(m[2])!,
      date: looseDate(m[3])!,
      time: m[4],
      channel: 'toll',
      counterparty: clean(m[5].replace(/^Toll Charges at /i, '').replace(/ toll plaza$/i, '')),
      balancePaise: amountToPaise(m[6])!,
    })
  }

  // Card statement
  if (/Credit Card Statement for the period/i.test(s)) {
    const m = new RegExp(
      String.raw`Payment due by ${DATE_WORDS} ICICI Bank Credit Card XX(\d+) Minimum Amount Due: ₹ ?${AMT} Total Amount Due: ₹ ?${AMT}`,
      'i',
    ).exec(t)
    if (!m) return { kind: 'unparsed', reason: 'ICICI statement layout not recognised' }
    return {
      kind: 'statement',
      template: 'icici.card_statement',
      account: { institution: 'icici', kind: 'credit_card', last4: tail(m[2]) },
      totalDuePaise: amountToPaise(m[4])!,
      minDuePaise: amountToPaise(m[3])!,
      dueDate: looseDate(m[1])!,
    }
  }

  return { kind: 'unparsed', reason: 'Unknown ICICI email' }
}
