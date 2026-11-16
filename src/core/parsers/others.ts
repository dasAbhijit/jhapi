/** SBI, DBS, PhonePe, Amazon Pay and CRED. */
import type { EmailInput, Institution, ParseResult, ParsedTxn } from './types'
import { AMT, DATE_MON, DATE_NUM, DATE_WORDS, TIME, amountToPaise, clean, looseDate, receivedDate, tail } from './text'

function txn(p: Omit<ParsedTxn, 'kind' | 'role'> & { role?: ParsedTxn['role'] }): ParsedTxn {
  return { kind: 'txn', role: 'primary', ...p }
}

/** SBI: cbsalerts.sbi@ and yonosbi@ at alerts.sbi.bank.in (alerts.sbi.co.in before). */
export function parseSbi(email: EmailInput, t: string): ParseResult {
  const s = email.subject.trim()
  if (/^CBSSBI ALERT/i.test(s)) {
    const m = new RegExp(String.raw`Your A/C X*(\d+) (Debited|Credited) INR ${AMT} on ${DATE_NUM} ?-(.+?)\.? Avl Bal(?:ance)? INR ${AMT}`, 'i').exec(t)
    if (!m) return { kind: 'unparsed', reason: 'SBI alert layout not recognised' }
    return txn({
      template: 'sbi.cbs',
      account: { institution: 'sbi', kind: 'bank', last4: tail(m[1]) },
      direction: m[2].toLowerCase() === 'debited' ? 'debit' : 'credit',
      amountPaise: amountToPaise(m[3])!,
      date: looseDate(m[4])!,
      channel: /transfer/i.test(m[5]) ? 'transfer' : 'other',
      counterparty: clean(m[5]),
      balancePaise: amountToPaise(m[6])!,
    })
  }
  if (/^Transaction success$/i.test(s)) {
    // YONO receipt. The CBS alert for the same money is the primary record.
    const m = new RegExp(
      String.raw`Amount Rs\.? ?${AMT} Transaction Number (\d+) Date of Transaction ${DATE_NUM} Debit account x(\d+) Beneficiary Name (.+?) Beneficiary Account Number x(\d+)`,
      'i',
    ).exec(t)
    if (!m) return { kind: 'unparsed', reason: 'YONO receipt layout not recognised' }
    return txn({
      template: 'sbi.yono',
      role: 'secondary',
      account: { institution: 'sbi', kind: 'bank', last4: tail(m[4]) },
      counterAccount: { institution: 'sbi', kind: 'bank', last4: tail(m[6]) },
      direction: 'debit',
      amountPaise: amountToPaise(m[1])!,
      date: looseDate(m[3])!,
      channel: 'transfer',
      counterparty: clean(m[5]),
      reference: m[2],
    })
  }
  if (/e-account statement|interest certificate/i.test(s)) return { kind: 'ignore', reason: 'SBI statement: figures only in the PDF' }
  return { kind: 'ignore', reason: 'SBI notice or offer' }
}

/** DBS digibank: digibankalerts@dbs.com, digibankconnect@dbs.com. */
export function parseDbs(email: EmailInput, t: string): ParseResult {
  const s = email.subject.trim()
  if (/^digibank alert/i.test(s)) {
    const upi = new RegExp(
      String.raw`funds transfer request for INR ${AMT} on ${DATE_MON} ${TIME} from your VPA (\S+) linked to Account Number X*(\d+) to Payee VPA (\S+) has been completed via UPI \(Ref No (\d+)\)`,
      'i',
    ).exec(t)
    if (upi) {
      return txn({
        template: 'dbs.upi',
        account: { institution: 'dbs', kind: 'bank', last4: tail(upi[5]) },
        direction: 'debit',
        amountPaise: amountToPaise(upi[1])!,
        date: looseDate(upi[2])!,
        time: upi[3],
        channel: 'upi',
        counterparty: upi[6],
        reference: upi[7],
      })
    }
    // DBS sends a second email for the same transfer, with the balance but no reference.
    const bal = new RegExp(
      String.raw`funds transfer request for INR ${AMT} from Account Number \**(\d+) has been completed on ${DATE_NUM}.*?available balance in your account is INR ${AMT}`,
      'i',
    ).exec(t)
    if (bal) {
      return txn({
        template: 'dbs.transfer_balance',
        role: 'secondary',
        account: { institution: 'dbs', kind: 'bank', last4: tail(bal[2]) },
        direction: 'debit',
        amountPaise: amountToPaise(bal[1])!,
        date: looseDate(bal[3])!,
        channel: 'transfer',
        balancePaise: amountToPaise(bal[4])!,
      })
    }
    return { kind: 'unparsed', reason: 'DBS alert layout not recognised' }
  }
  if (/^Debit alert for non/i.test(s)) {
    const m = new RegExp(String.raw`A/c \**(\d+) is debited with INR ${AMT} on ${DATE_NUM} for (.+?)\. Current balance: INR ${AMT}`, 'i').exec(t)
    if (!m) return { kind: 'unparsed', reason: 'DBS charge layout not recognised' }
    return txn({
      template: 'dbs.fee',
      account: { institution: 'dbs', kind: 'bank', last4: tail(m[1]) },
      direction: 'debit',
      amountPaise: amountToPaise(m[2])!,
      date: looseDate(m[3])!,
      channel: 'fee',
      counterparty: clean(m[4]),
      balancePaise: amountToPaise(m[5])!,
    })
  }
  return { kind: 'ignore', reason: 'DBS notice or offer' }
}

const BANK_NAMES: [RegExp, Institution][] = [
  [/axis/i, 'axis'],
  [/icici/i, 'icici'],
  [/state bank|\bsbi\b/i, 'sbi'],
  [/dbs/i, 'dbs'],
]

function bankFromName(name: string): Institution | null {
  return BANK_NAMES.find(([r]) => r.test(name))?.[1] ?? null
}

/**
 * PhonePe receipts. The bank sends its own alert for the same money, with the same UPI reference
 * (PhonePe's "Bank Ref. No."), so these are secondary: they add the real merchant or biller name.
 */
export function parsePhonePe(email: EmailInput, t: string): ParseResult {
  const s = email.subject.trim()
  if (/autopay will be debited/i.test(s)) return { kind: 'ignore', reason: 'Reminder of an upcoming AutoPay' }
  const sent = new RegExp(
    String.raw`${DATE_WORDS} Paid to (.+?) ₹ ?${AMT} Txn\. ID : (\S+) Txn\. status : (\w+) Debited from : X*(\d+) (.+?) Bank Ref\. No\. : (\d+)`,
    'i',
  ).exec(t)
  const bill = new RegExp(
    String.raw`${DATE_WORDS} Payment For (.+?) ₹ ?${AMT} Txn\. ID : (\S+) Txn\. status : (\w+) Debited from Account X*(\d+) (.+?) : ₹ ?[\d,.]+ Bank Ref\. No\. : (\d+).*?Category : (.+?) Provider : (.+?) Hi`,
    'i',
  ).exec(t)
  const m = sent ?? bill
  if (!m) return { kind: 'unparsed', reason: 'PhonePe receipt layout not recognised' }
  if (!/success/i.test(m[5])) return { kind: 'ignore', reason: `PhonePe payment ${m[5].toLowerCase()}` }
  const bank = bankFromName(m[7])
  if (!bank) return { kind: 'unparsed', reason: `PhonePe paid from an unknown bank: ${m[7]}` }
  return txn({
    template: sent ? 'phonepe.upi' : 'phonepe.bill',
    role: 'secondary',
    account: { institution: bank, kind: 'bank', last4: tail(m[6]) },
    direction: 'debit',
    amountPaise: amountToPaise(m[3])!,
    date: looseDate(m[1])!,
    channel: sent ? 'upi' : 'bill_payment',
    counterparty: sent ? clean(m[2]) : `${clean(m[10])} ${clean(m[9])}`,
    reference: m[8],
  })
}

/** Amazon Pay. Only payments from the Amazon Pay balance (a wallet) are new money movements. */
export function parseAmazonPay(email: EmailInput, t: string): ParseResult {
  const s = email.subject.trim()
  const paid = new RegExp(String.raw`^Rs\.? ?${AMT} was paid on Amazon\.in`, 'i').exec(s)
  if (paid) {
    if (!/Amazon Pay Balance/i.test(t)) return { kind: 'ignore', reason: 'Paid by card or bank, which sends its own alert' }
    return txn({
      template: 'amazonpay.balance',
      account: { institution: 'amazonpay', kind: 'wallet', last4: null },
      direction: 'debit',
      amountPaise: amountToPaise(paid[1])!,
      date: receivedDate(email.receivedAt),
      channel: 'wallet',
      counterparty: 'Amazon.in',
    })
  }
  // Bill payments are charged to a card or bank, which sends its own alert. The plain text of these
  // emails wrongly says "failed", so never read the outcome from the body.
  if (/bill payment|auto ?payment|payment reminder|cashback/i.test(s)) {
    return { kind: 'ignore', reason: 'Bill payment receipt: the card or bank alert is the record' }
  }
  if (/refund gift card/i.test(s)) return { kind: 'unparsed', reason: 'Amazon Pay refund: the email does not give the amount' }
  return { kind: 'ignore', reason: 'Amazon Pay notice' }
}

/** CRED repeats the card issuer's statement. The issuer's statement email is the record. */
export function parseCred(): ParseResult {
  return { kind: 'ignore', reason: 'CRED repeats the card statement' }
}
