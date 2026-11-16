/**
 * Parser tests on SYNTHETIC emails. Each one copies the layout of a real bank email word for word,
 * but every name, account number, reference and amount is made up. Real emails stay in the
 * git-ignored samples/ folder and are checked by samples.local.test.ts on the owner's machine.
 */
import { describe, expect, it } from 'vitest'
import { findSender, parseEmail, SENDERS } from './index'
import { amountToPaise, flatten, looseDate } from './text'
import type { EmailInput } from './types'

const mail = (from: string, subject: string, text: string, receivedAt = '2026-11-16T15:15:25Z'): EmailInput => ({ from, subject, text, receivedAt })

const AXIS = 'Axis Bank Alerts <alerts@axis.bank.in>'

describe('text helpers', () => {
  it('reads amounts', () => {
    expect(amountToPaise('1,00,000.50')).toBe(10000050)
    expect(amountToPaise('INR 44500')).toBe(4450000)
    expect(amountToPaise('₹ 38227.00')).toBe(3822700)
    expect(amountToPaise('Rs.3900.00')).toBe(390000)
    expect(amountToPaise('12a')).toBeNull()
  })
  it('reads every date style the banks use', () => {
    expect(looseDate('16-11-26')).toBe('2026-11-16')
    expect(looseDate('27-08-2026')).toBe('2026-08-27')
    expect(looseDate('30/03/26')).toBe('2026-03-30')
    expect(looseDate('30.03.26')).toBe('2026-03-30')
    expect(looseDate('20-Oct-2026')).toBe('2026-10-20')
    expect(looseDate('30-Sep-26')).toBe('2026-09-30')
    expect(looseDate('Oct 20, 2026')).toBe('2026-10-20')
    expect(looseDate('January 05, 2026')).toBe('2026-01-05')
    expect(looseDate('Apr 9, 2025')).toBe('2025-04-09')
    expect(looseDate('31-02-2026')).toBeNull()
  })
  it('flattens table layouts and links', () => {
    expect(flatten('| | Amount Debited: INR 90.00 |\n| [x](https://e.x/y) |')).toBe('Amount Debited: INR 90.00 x')
  })
})

describe('allow-list', () => {
  it('accepts listed senders on old and new domains, refuses look-alikes', () => {
    expect(findSender('Axis Bank Alerts <alerts@axis.bank.in>')?.institution).toBe('axis')
    expect(findSender('alerts@axisbank.com')?.institution).toBe('axis')
    expect(findSender('ALERTS@AXIS.BANK.IN')?.institution).toBe('axis')
    expect(findSender('alerts@axis-bank.in')).toBeNull()
    expect(findSender('services@custcomm.icici.bank.in')).toBeNull()
    expect(parseEmail(mail('alerts@axis.bank.in.evil.com', 'INR 1.00 was debited from your A/c no. XX1111.', '')).kind).toBe('ignore')
  })
  it('every sender has a DKIM domain that it belongs to', () => {
    for (const s of SENDERS) expect(s.match.endsWith(s.dkimDomain)).toBe(true)
  })
})

describe('Axis', () => {
  const upiLines = `
                                        16-11-2026
                                        Dear Asha Rao,
                                        Here's the summary of your transaction:
                                                Amount Debited:
                                                INR 1,250.50
                                                Account Number:
                                                XX1111
                                                Date & Time:
                                                16-11-26, 20:45:24 IST
                                                Transaction Info:
                                                UPI/P2M/600000000001/Mr RAVI KUMAR
                                        If this transaction was not initiated by you:
                                                            To block UPI: SMS BLOCKUPI <Customer ID> to +910000000000`

  it('UPI debit, line-per-label layout', () => {
    expect(parseEmail(mail(AXIS, 'INR 1,250.50 was debited from your A/c no. XX1111.', upiLines))).toEqual({
      kind: 'txn',
      role: 'primary',
      template: 'axis.upi',
      account: { institution: 'axis', kind: 'bank', last4: '1111' },
      direction: 'debit',
      amountPaise: 125050,
      date: '2026-11-16',
      time: '20:45:24',
      channel: 'upi',
      reference: '600000000001',
      counterparty: 'Mr RAVI KUMAR',
    })
  })

  it('UPI debit, table layout (older domain)', () => {
    const table = `| 26-12-2025 |
| Dear Asha Rao, Here's the summary of your transaction: |
| |
| | Amount Debited: INR 90.00 |
| | Account Number: XX1111 |
| | Date & Time: 26-12-25, 20:32:12 IST |
| | Transaction Info: UPI/P2A/600000000002/PRIYA SEN |
| |
| If this transaction was not initiated by you: |`
    const r = parseEmail(mail('alerts@axisbank.com', 'INR 90.00 was debited from your A/c no. XX1111.', table))
    expect(r).toMatchObject({ kind: 'txn', amountPaise: 9000, date: '2025-12-26', counterparty: 'PRIYA SEN', reference: '600000000002' })
  })

  it('UPI credit with bank and note in the narration', () => {
    const t = upiLines.replace('Amount Debited:', 'Amount Credited:').replace('UPI/P2M/600000000001/Mr RAVI KUMAR', 'UPI/P2A/600000000003/MEERA /SBIN/Part').replace('If this transaction was not initiated by you:', 'Feel free to connect with us')
    expect(parseEmail(mail(AXIS, 'INR 1,250.50 was credited to your A/c.', t))).toMatchObject({ direction: 'credit', counterparty: 'MEERA', reference: '600000000003' })
  })

  it('account credit by NEFT, dividend (ACH) and salary', () => {
    const body = (narr: string) =>
      `27-08-2026 Dear Asha Rao, Thank you for banking with us. We wish to inform you that your A/c no. XX1111 has been credited with INR 12345.00 on 27-08-2026 at 06:31:33 IST by ${narr}. To check your available balance, please click here .`
    const subj = 'Credit transaction alert for Axis Bank A/c'
    expect(parseEmail(mail(AXIS, subj, body('NEFT/SBIN000000000001/ACME CORP')))).toMatchObject({
      template: 'axis.account', channel: 'neft', reference: 'SBIN000000000001', counterparty: 'ACME CORP', amountPaise: 1234500, time: '06:31:33',
    })
    expect(parseEmail(mail(AXIS, subj, body('ACH-CR-EXAMPLE METALS LTD')))).toMatchObject({ channel: 'ach', counterparty: 'EXAMPLE METALS LTD' })
    expect(parseEmail(mail(AXIS, subj, body('EXAMPLE TECH LIMITED/')))).toMatchObject({ channel: 'other', counterparty: 'EXAMPLE TECH LIMITED' })
  })

  it('account debit by ACH (loan EMI) and ECS', () => {
    const body = (narr: string) =>
      `08-08-2026 Dear Asha Rao, Thank you for banking with us. We wish to inform you that your A/c no. XX1111 has been debited with INR 40000.00 on 08-08-2026 07:56:17 IST by ${narr}. To check your available balance, please click here .  Please SMS BLOCKALL <Space> <Cust ID>`
    const subj = 'Debit transaction alert for Axis Bank A/c'
    expect(parseEmail(mail(AXIS, subj, body('ACH-DR-EXAMPLEBANK-00000000-UT')))).toMatchObject({ direction: 'debit', channel: 'ach', counterparty: 'EXAMPLEBANK-00000000-UT', date: '2026-08-08' })
    expect(parseEmail(mail(AXIS, subj, body('ECS/UTIBDE00000000000000/T')))).toMatchObject({ channel: 'ecs', reference: 'UTIBDE00000000000000' })
  })

  it('debit card at an ATM and a shop, with balance', () => {
    const body = (at: string) =>
      `18-08-2026 Dear Customer, Thank you for banking with us. We wish to inform you that INR 5000.00 has been debited from your A/c no. XX001111 on 18-08-2026 21:54:29 at ${at}. Available balance: INR 1,23,456.78. Please SMS BLOCKCARD 2222 to +910000000000`
    expect(parseEmail(mail(AXIS, 'Notification from Axis Bank', body('ATM-WDL/00000000001/600000000004')))).toMatchObject({
      template: 'axis.atm', channel: 'atm', account: { last4: '1111' }, balancePaise: 12345678, reference: '600000000004',
    })
    expect(parseEmail(mail(AXIS, 'Notification from Axis Bank', body('PUR/Example Cinema City/000000000001/600000000005')))).toMatchObject({
      template: 'axis.debit_card', channel: 'pos', counterparty: 'Example Cinema City',
    })
  })

  it('older notification layout (IMPS credit, pre-2025 UPI)', () => {
    const t = `21-11-2025 Dear Customer, Thank you for banking with us. INR 1.00 has been credited to A/c no. XX1111 on 21-11-25 at 15:37:11 IST. Reference no. - IMPS/P2A/600000000006/EXAMPLECO For any concerns regarding this transaction`
    expect(parseEmail(mail(AXIS, 'Credit notification from Axis Bank', t))).toMatchObject({ direction: 'credit', channel: 'imps', reference: '600000000006', counterparty: 'EXAMPLECO', date: '2025-11-21' })
    const d = `10-12-2024 Dear Asha Rao, INR 20.00 has been debited from A/c no. XX1111 on 10-12-24 at 17:27:14 IST. Info- UPI/P2M/600000000007/TEA STALL. For any concerns regarding this transaction`
    expect(parseEmail(mail('alerts@axisbank.com', 'Debit notification from Axis Bank', d))).toMatchObject({ direction: 'debit', channel: 'upi', counterparty: 'TEA STALL', date: '2024-12-10' })
  })

  it('credit card spend, old and new layouts', () => {
    const old = `25-08-2026 Dear Asha Rao, Here's the summary of your Axis Bank Credit Card Transaction: Transaction Amount: INR 24098 Merchant Name: EXAMPLE STORE Axis Bank Credit Card No. XX3333 Date & Time: 25-08-2026, 22:23:10 IST Available Limit*: INR 774283.52 Total Credit Limit*: INR 800000`
    expect(parseEmail(mail(AXIS, 'INR 24098 spent on credit card no. XX3333', old))).toMatchObject({
      template: 'axis.card', account: { kind: 'credit_card', last4: '3333' }, amountPaise: 2409800, counterparty: 'EXAMPLE STORE', availableLimitPaise: 77428352,
    })
    const neu = `15-11-2026 Dear Customer, Here's the summary of your Axis Bank Credit Card transaction: Transaction amount (INR): INR 44500 Merchant name: EXAMPLE TRAVEL Axis Bank Credit Card No.: XX3333 Date and time: 15-11-2026 18:35:45 IST Available limit (INR): 755500 Total credit limit (INR): 800000`
    expect(parseEmail(mail(AXIS, 'Transaction alert on Axis Bank Credit Card', neu))).toMatchObject({ amountPaise: 4450000, time: '18:35:45', availableLimitPaise: 75550000 })
  })

  it('outward NEFT: two wordings, account unknown', () => {
    const a = `01-Sep-2026 Dear Customer, Thank you for banking with us. Your NEFT transaction with reference no. AXOMB00000000001 for INR 500000.00 has been successfully credited to the beneficiary : EXAMPLE CLEARING LTD, A/c no. XXJ000 on September 01, 2026 at 01:41:13 IST.`
    expect(parseEmail(mail('AxisBank.Alerts@axis.bank.in', 'Your NEFT/RTGS transaction is successful', a))).toMatchObject({
      template: 'axis.neft_out', account: { last4: null }, reference: 'AXOMB00000000001', counterparty: 'EXAMPLE CLEARING LTD', date: '2026-09-01',
    })
    const b = `Dear Customer, Thank you for banking with us. Your NEFT Txn. with Ref. no AXOMB00000000002 for Rs. 63241.00 has been credited to beneficiary : EXAMPLE BUILDERS COLLECTION ACCOUNT on February 13, 2026 at 18:10:17 Hrs.`
    expect(parseEmail(mail('AxisBank.Alerts@axis.bank.in', 'Your NEFT/RTGS transaction is successful', b))).toMatchObject({ amountPaise: 6324100, date: '2026-02-13' })
  })

  it('credit card statement', () => {
    const t = `Dear Customer, Please find enclosed your credit card statement for AUGUST 2026. Total Amount Due INR Minimum Amount Due (INR) Payment Due Date (DD-MM-YYYY) 1618.48 Dr 100 Dr 07/09/2026 How do I access my statement?`
    expect(parseEmail(mail('cc.statements@axis.bank.in', 'Your Axis Bank Select Credit Card Statement ending XX33 - August 2026', t))).toEqual({
      kind: 'statement', template: 'axis.card_statement', account: { institution: 'axis', kind: 'credit_card', last4: '33' }, totalDuePaise: 161848, minDuePaise: 10000, dueDate: '2026-09-07',
    })
  })

  it('ignores notices and reports unknown layouts as not parsed', () => {
    expect(parseEmail(mail(AXIS, 'Scheduled maintenance intimation', 'x')).kind).toBe('ignore')
    expect(parseEmail(mail(AXIS, 'INR 5.00 was debited from your A/c no. XX1111.', 'a brand new layout')).kind).toBe('unparsed')
    expect(parseEmail(mail(AXIS, 'Something new from Axis', 'x')).kind).toBe('unparsed')
  })
})

describe('ICICI', () => {
  const CC = 'credit_cards@icici.bank.in'
  it('card spend', () => {
    const t = `ICICI Bank Online Dear Customer, Your ICICI Bank Credit Card XX4444 has been used for a transaction of INR 15,968.10 on Oct 21, 2026 at 02:04:54. Info: EXAMPLE FOODS LTD. The Available Credit Limit on your card is INR 83,691.90 and Total Credit Limit is INR 1,00,000.00.`
    expect(parseEmail(mail(CC, 'Transaction alert for your ICICI Bank Credit Card', t))).toMatchObject({
      template: 'icici.card', account: { kind: 'credit_card', last4: '4444' }, amountPaise: 1596810, date: '2026-10-21', counterparty: 'EXAMPLE FOODS LTD', availableLimitPaise: 8369190,
    })
  })
  it('bill payment, reversal and refund are credits to the card', () => {
    const pay = `Dear Customer, Oct 20,2026 Greetings from ICICI Bank! We have received payment of INR 28,418.90 on your ICICI Bank Credit Card account 4000 XXXX XXXX 4444 on 20-Oct-2026. Looking forward`
    expect(parseEmail(mail(CC, 'Payment received on your ICICI Bank Credit Card.', pay))).toMatchObject({ direction: 'credit', channel: 'card_payment', account: { last4: '4444' }, amountPaise: 2841890, date: '2026-10-20' })
    const rev = `Dear Customer, Jan 05, 2026 Greetings from ICICI Bank. We wish to inform you that the reversal of INR 18.53 has been done on your ICICI Bank Credit Card XX4444 on January 05, 2026. For any clarification`
    expect(parseEmail(mail('credit_cards@icicibank.com', 'Reversal processed on your ICICI Bank Credit Card XX4444', rev))).toMatchObject({ direction: 'credit', channel: 'refund', amountPaise: 1853 })
    const ref = `Dear Customer, Oct 26, 2025 Greetings from ICICI Bank. We have received merchant credit refund on your ICICI Bank Credit Card XX4444 for INR 438.96 on October 25, 2025 from EXAMPLE PAY ECOMM. We wish to inform you`
    expect(parseEmail(mail(CC, 'Merchant credit refund on your ICICI Bank Credit Card XX4444', ref))).toMatchObject({ counterparty: 'EXAMPLE PAY ECOMM', date: '2025-10-25' })
  })
  it('standing instruction note is secondary', () => {
    const t = `We have successfully processed your payment of INR 3900.00 towards Example Utility, with Standing Instruction ABCDEF1234, on 21/10/2026, through your ICICI Bank Credit Card 4444. Click here`
    expect(parseEmail(mail('cards@icici.bank.in', 'Transaction Success notification for Standing Instruction on your ICICI Bank Credit Card', t))).toMatchObject({
      role: 'secondary', reference: 'ABCDEF1234', counterparty: 'Example Utility', date: '2026-10-21',
    })
  })
  it('savings interest credit and iMobile card payment', () => {
    const int = `Dear Customer, Greetings from ICICI Bank. Your ICICI Bank Account XX555 has been credited with INR 270 on 30-Sep-26. Info: XX555:Int.Pd:30-06-2026 to 29-09-2026. NEVER SHARE your Card number`
    expect(parseEmail(mail('customernotification@icici.bank.in', 'Transaction alert for your ICICI Bank account', int))).toMatchObject({ channel: 'interest', account: { last4: '555' }, amountPaise: 27000, date: '2026-09-30' })
    const imob = `iMobile Fund Transfer Dear Customer, You have made a payment of ₹ 38227.00 using iMobile towards XXXXXXXXXXXX4444 from your Account XXXXXXXXX555 . The payment was initiated through Transaction ID : 1000000001 on Jan 01, 2026 at 23:52 hours.`
    expect(parseEmail(mail('customercare@icicibank.com', 'Transaction alert for your ICICI Bank Mobile Banking', imob))).toMatchObject({
      channel: 'transfer', account: { kind: 'bank', last4: '555' }, counterAccount: { kind: 'credit_card', last4: '4444' }, time: '23:52',
    })
  })
  it('FASTag toll and card statement', () => {
    const tag = `ICICI Bank Online Dear Customer, Your ICICI Bank FASTag linked to Vehicle No. XX00AB1234 has been debited with 10.00 on 11-11-2026 at 11:52:53 for Toll Charges at Example Bridge Toll toll plaza. The available Balance is 220.00.`
    expect(parseEmail(mail('services@icici.bank.in', 'ICICI Bank FASTag transaction alert', tag))).toMatchObject({ channel: 'toll', account: { kind: 'fastag', last4: '1234' }, counterparty: 'Example Bridge Toll', balancePaise: 22000 })
    const st = `Credit Card Statement Payment due by November 30, 2026 ICICI Bank Credit Card XX4444 Minimum Amount Due: ₹1,020.00 Total Amount Due: ₹20,208.10 Pay now using:`
    expect(parseEmail(mail(CC, 'Amazon Pay ICICI Bank Credit Card Statement for the period October 13, 2026 to November 12, 2026', st))).toMatchObject({
      kind: 'statement', totalDuePaise: 2020810, minDuePaise: 102000, dueDate: '2026-11-30',
    })
  })
  it('ignores reminders', () => {
    expect(parseEmail(mail('cards@icici.bank.in', 'Upcoming payment notification: Standing Instructions on your card', 'x')).kind).toBe('ignore')
  })
})

describe('SBI', () => {
  it('CBS alerts in Hindi and English', () => {
    const d = `भारतीय स्टेट बैंक की ओर से शुभकामनाएं ! Greetings from SBI ! Your A/C XXXXX001111 Debited INR 500.00 on 30/03/26 -Transferred to Ms. ASHA RAO. Avl Balance INR 9,096.15-SBI कृपया`
    expect(parseEmail(mail('cbsalerts.sbi@alerts.sbi.bank.in', 'CBSSBI ALERT', d))).toMatchObject({
      account: { institution: 'sbi', last4: '1111' }, direction: 'debit', amountPaise: 50000, date: '2026-03-30', channel: 'transfer', balancePaise: 909615,
    })
    const c = d.replace('Debited', 'Credited').replace('Transferred to', 'Deposit by transfer from').replace('Avl Balance', 'Avl Bal')
    expect(parseEmail(mail('cbsalerts.sbi@alerts.sbi.co.in', 'CBSSBI ALERT', c))).toMatchObject({ direction: 'credit' })
  })
  it('YONO receipt is secondary; offers are ignored', () => {
    const t = `Dear ASHA RAO Thank you for using YONO SBI for Fund Transfer The transaction details are as follows: Description Details Transaction Status Successful Amount Rs.500.00 Transaction Number 500000001 Date of Transaction 30.03.26 Debit account x1111 Beneficiary Name ASHA RAO Beneficiary Account Number x2222 Reach Us at:`
    expect(parseEmail(mail('yonosbi@alerts.sbi.bank.in', 'Transaction success', t))).toMatchObject({ role: 'secondary', counterAccount: { last4: '2222' }, date: '2026-03-30' })
    expect(parseEmail(mail('yonosbi@alerts.sbi.bank.in', 'Invest today in an SBI fund', 'x')).kind).toBe('ignore')
  })
})

describe('DBS', () => {
  it('UPI transfer, its balance twin, and a charge', () => {
    const upi = `Dear Customer, Thank you for choosing DBS Bank. Your funds transfer request for INR 14000.00 on 25-May-2026 16:26 from your VPA asha@dbs linked to Account Number XXXXXXXX6666 to Payee VPA asha@axisbank has been completed via UPI (Ref No 600000000008) and the funds`
    expect(parseEmail(mail('digibankalerts@dbs.com', 'digibank alert – Funds transfer successful via UPI', upi))).toMatchObject({
      template: 'dbs.upi', role: 'primary', reference: '600000000008', counterparty: 'asha@axisbank', time: '16:26', date: '2026-05-25',
    })
    const bal = `Dear Customer, Thank you for choosing DBS Bank. Your funds transfer request for INR 14000 from Account Number ********6666 has been completed on 25-05-2026 and the funds have been credited to the beneficiary account. The available balance in your account is INR 797.31. If you`
    expect(parseEmail(mail('digibankalerts@dbs.com', 'digibank alert ? Funds transfer successful', bal))).toMatchObject({ role: 'secondary', balancePaise: 79731 })
    const fee = `Dear Customer, Your DBS Bank A/c ********6666 is debited with INR 191.45 on 18-09-2026 for Monthly Avg Bal non-maintenance fee. Current balance: INR 10139.86 as of 18/Sep/2026 02:09:44.`
    expect(parseEmail(mail('digibankconnect@dbs.com', 'Debit alert for non– maintenance fee of Monthly Avg Balance for your DBS Account', fee))).toMatchObject({ channel: 'fee', amountPaise: 19145 })
  })
})

describe('PhonePe and Amazon Pay', () => {
  it('PhonePe receipts are secondary and carry the bank reference', () => {
    const sent = `Apr 9, 2025 Paid to EXAMPLE DECOR ₹ 10000 Txn. ID : T0000000000000000001 Txn. status : Successful Debited from : XXXX001111 Axis Bank Bank Ref. No. : 600000000009 Message : Hi Asha`
    expect(parseEmail(mail('PhonePe <noreply@phonepe.com>', 'Sent ₹ 10000 to EXAMPLE DECOR', sent))).toMatchObject({
      role: 'secondary', account: { institution: 'axis', last4: '1111' }, reference: '600000000009', counterparty: 'EXAMPLE DECOR', date: '2025-04-09',
    })
    const bill = `Nov 5, 2026 Payment For 98XXXX0000 ₹149 Txn. ID : NB0000000000000000001 Txn. status : Successful Debited from Account XXXX001111 Axis Bank : ₹149 Bank Ref. No. : 600000000010 Bill/Recharge Amount : ₹147 Service fee inclusive of GST * : ₹2 Category : Mobile Provider : EXAMPLETEL Hi Asha`
    expect(parseEmail(mail('noreply@phonepe.com', 'Payment for EXAMPLETEL Mobile of ₹ 149 is successful', bill))).toMatchObject({ channel: 'bill_payment', counterparty: 'EXAMPLETEL Mobile', amountPaise: 14900 })
  })
  it('Amazon Pay: wallet payments count, bill receipts do not, and "failed" text is not trusted', () => {
    expect(parseEmail(mail('no-reply@amazonpay.in', 'Rs 604.00 was paid on Amazon.in', 'Hi Asha, Thanks for using Amazon Pay Balance. Your payment was successful.', '2026-11-15T20:00:00Z'))).toMatchObject({
      account: { kind: 'wallet' }, amountPaise: 60400, date: '2026-11-16', // 20:00 UTC is 01:30 next day in India
    })
    expect(parseEmail(mail('no-reply@amazonpay.in', 'Your Electricity bill payment for Rs.3900.00 is successful', 'Hi Asha, We are sorry that your Electricity bill payment for Rs.3900.00 has failed.')).kind).toBe('ignore')
    expect(parseEmail(mail('no-reply@amazonpay.in', 'Amazon has added a Refund Gift Card to your Amazon Pay balance', 'x')).kind).toBe('unparsed')
  })
})
