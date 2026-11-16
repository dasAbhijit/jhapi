import { describe, expect, it } from 'vitest'
import { enrichFromReceipts, guessCategory, pairTransfers, ruleCategory, type Rule, type Txn } from './records'

const base: Txn = {
  id: '', date: '2026-11-16', time: '', account: 'axis-bank-1111', direction: 'debit', amountPaise: 100000, counterparty: '',
  category: 'Other', channel: 'upi', reference: '', balancePaise: null, status: 'verified', source: 'email', note: '', emailId: '',
  template: '', updatedAt: '2026-11-16T00:00:00.000Z', deleted: false,
}
const tx = (p: Partial<Txn>): Txn => ({ ...base, ...p })

describe('category rules', () => {
  const rules: Rule[] = [
    { id: '1', contains: 'swiggy', category: 'Eating out', updatedAt: '', deleted: false },
    { id: '2', contains: 'zomato', category: 'Eating out', updatedAt: '', deleted: true },
  ]
  it('matches case-insensitively, skips deleted rules', () => {
    expect(ruleCategory('SWIGGY LIMITED', rules)).toBe('Eating out')
    expect(ruleCategory('Zomato', rules)).toBeNull()
    expect(ruleCategory('', rules)).toBeNull()
  })
  it('seed guesses', () => {
    expect(guessCategory({ channel: 'upi', direction: 'debit', counterparty: 'BSNL Mobile' })).toBe('Bills')
    expect(guessCategory({ channel: 'atm', direction: 'debit', counterparty: '' })).toBe('Cash')
    expect(guessCategory({ channel: 'ach', direction: 'credit', counterparty: 'EXAMPLE METALS' })).toBe('Dividend')
    expect(guessCategory({ channel: 'neft', direction: 'credit', counterparty: 'ACME' })).toBe('Income')
  })
})

describe('transfer pairing', () => {
  it('pairs a UPI payment to the owner\'s own handle at the other bank', () => {
    const d = tx({ id: 'd', account: 'dbs-bank-6666', counterparty: 'asha@axisbank' })
    const c = tx({ id: 'c', direction: 'credit', counterparty: 'ASHA RAO' })
    expect(pairTransfers([d, c])).toEqual([
      { id: 'd', category: 'Transfer', note: 'To Axis Bank ••1111' },
      { id: 'c', category: 'Transfer', note: 'From DBS Bank ••6666' },
    ])
  })
  it('pairs SBI transfers that name the same person on both sides', () => {
    const d = tx({ id: 'd', account: 'sbi-bank-1111', counterparty: 'Transferred to Ms. ASHA RAO', channel: 'transfer' })
    const c = tx({ id: 'c', account: 'sbi-bank-2222', direction: 'credit', counterparty: 'Deposit by transfer from Ms. ASHA RAO', channel: 'transfer' })
    expect(pairTransfers([d, c]).map((u) => u.id)).toEqual(['d', 'c'])
  })
  it('pairs a card bill paid through CRED with the card\'s payment credit, up to 3 days apart', () => {
    const d = tx({ id: 'd', counterparty: 'CRED Club', date: '2026-11-14' })
    const c = tx({ id: 'c', account: 'icici-credit_card-4444', direction: 'credit', channel: 'card_payment', counterparty: 'Card bill payment' })
    expect(pairTransfers([d, c])).toHaveLength(2)
  })
  it('does not pair different amounts, the same account, far-apart dates, strangers, or rows not counted', () => {
    const d = tx({ id: 'd', account: 'dbs-bank-6666', counterparty: 'asha@axisbank' })
    const c = tx({ id: 'c', direction: 'credit', counterparty: 'X' })
    expect(pairTransfers([d, { ...c, amountPaise: 99 }])).toEqual([])
    expect(pairTransfers([{ ...d, account: 'axis-bank-1111' }, c])).toEqual([])
    expect(pairTransfers([d, { ...c, date: '2026-11-19' }])).toEqual([])
    expect(pairTransfers([{ ...d, counterparty: 'friend@okaxis' }, { ...c, account: 'icici-bank-555' }])).toEqual([])
    expect(pairTransfers([{ ...d, status: 'receipt' }, c])).toEqual([])
    // A payment to a friend's Axis handle and an unrelated Axis credit of the same amount: paired only if handle bank matches
    expect(pairTransfers([{ ...d, counterparty: 'friend@okicici' }, c])).toEqual([])
  })
  it('uses each transaction once', () => {
    const d = tx({ id: 'd', account: 'dbs-bank-6666', counterparty: 'asha@axisbank' })
    const c1 = tx({ id: 'c1', direction: 'credit' })
    const c2 = tx({ id: 'c2', direction: 'credit' })
    expect(pairTransfers([d, c1, c2])).toHaveLength(2)
  })
})

describe('receipts improve the bank row', () => {
  it('copies the payee when missing and a better category, matched by reference and amount', () => {
    const bank = tx({ id: 'b', reference: '600000000001', counterparty: '', category: 'Other' })
    const receipt = tx({ id: 'r', status: 'receipt', reference: '600000000001', counterparty: 'EXAMPLETEL Mobile', category: 'Bills' })
    expect(enrichFromReceipts([bank, receipt])).toEqual([{ id: 'b', counterparty: 'EXAMPLETEL Mobile', category: 'Bills' }])
    expect(enrichFromReceipts([{ ...bank, category: 'Food', counterparty: 'X' }, receipt])).toEqual([])
    expect(enrichFromReceipts([bank, { ...receipt, amountPaise: 1 }])).toEqual([])
  })
})
