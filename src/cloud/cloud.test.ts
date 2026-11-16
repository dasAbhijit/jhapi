/**
 * Runs the BUILT cloud/Code.gs (run `npm run build:cloud` after changing it) against fake Google
 * services: setup, reading bank emails, pull, push and hand edits in the sheet.
 */
import { describe, expect, it } from 'vitest'
import { checkSender } from '../core/dkim'
import { REVIEW_TAB, RULES_TAB, STATEMENT_TAB, TXN_HEADERS, TXN_TAB } from '../core/sheetRows'
import { makeEnv, passAuth, type FakeMessage } from './fakeGoogle'

const col = (h: string) => (TXN_HEADERS as readonly string[]).indexOf(h)

const axisUpi = (id: string, amount: string, rrn: string, extra: Partial<FakeMessage> = {}): FakeMessage => ({
  id,
  from: 'Axis Bank Alerts <alerts@axis.bank.in>',
  subject: `INR ${amount} was debited from your A/c no. XX1111.`,
  date: '2026-11-16T15:15:25Z',
  body: `Dear Asha Rao, Here's the summary of your transaction: Amount Debited: INR ${amount} Account Number: XX1111 Date & Time: 16-11-26, 20:45:24 IST Transaction Info: UPI/P2M/${rrn}/SWIGGY If this transaction was not initiated by you:`,
  auth: passAuth('axis.bank.in'),
  ...extra,
})

function ready() {
  const env = makeEnv()
  env.fn('setup')()
  const token = env.props.JHAPI_TOKEN
  return { env, token }
}

describe('setup', () => {
  it('creates the tabs, a long secret code and one 10-minute trigger', () => {
    const { env, token } = ready()
    expect(token).toMatch(/^[0-9a-f]{64}$/)
    expect(Object.keys(env.sheets).sort()).toEqual(['Goals', 'Holdings', 'Log', 'Net worth', 'Review', 'Rules', 'Statements', 'Transactions'])
    expect(env.tab(TXN_TAB)[0]).toEqual([...TXN_HEADERS])
    expect(env.sheets[TXN_TAB].frozen).toBe(1)
    env.fn('setup')()
    expect(env.triggers).toEqual(['readInbox', 'refreshPrices'])
    expect(env.props.JHAPI_TOKEN).toBe(token)
    expect(env.logs.join('\n')).toContain(token) // shown in the execution log when there is no sheet UI
  })
})

describe('web app security', () => {
  it('refuses calls until set up, and with a wrong or missing code', () => {
    const env = makeEnv()
    expect(env.call({ token: 'x', action: 'pull' }).error).toMatch(/not set up/)
    const { env: e2 } = ready()
    expect(e2.call({ token: 'nope', action: 'pull' })).toMatchObject({ ok: false, code: 'auth' })
    expect(e2.call({ action: 'pull' })).toMatchObject({ ok: false, code: 'auth' })
    expect(e2.call('not json').ok).toBe(false)
  })
})

describe('reading bank emails', () => {
  it('adds verified transactions, receipts and statements; sends blocked and unparsed ones to Review', () => {
    const { env } = ready()
    env.messages.push(
      axisUpi('m1', '250.00', '600000000001'),
      // Same subject, same thread: still read
      axisUpi('m2', '250.00', '600000000002', { date: '2026-11-16T16:00:00Z' }),
      // Spoofed: right From, but Gmail found no Axis signature
      axisUpi('m3', '99.00', '600000000003', { auth: 'mx.google.com; dkim=fail header.i=@axis.bank.in; spf=softfail' }),
      // Layout the parser does not know
      { id: 'm4', from: 'alerts@axis.bank.in', subject: 'INR 5.00 was debited from your A/c no. XX1111.', date: '2026-11-16T17:00:00Z', body: 'brand new layout', auth: passAuth('axis.bank.in') },
      // Notice: ignored
      { id: 'm5', from: 'alerts@axis.bank.in', subject: 'Scheduled maintenance intimation', date: '2026-11-16T18:00:00Z', body: 'x', auth: passAuth('axis.bank.in') },
      // PhonePe receipt for m1's money: a Receipt row
      {
        id: 'm6', from: 'PhonePe <noreply@phonepe.com>', subject: 'Sent ₹ 250 to SWIGGY', date: '2026-11-16T15:16:00Z', auth: passAuth('phonepe.com'),
        body: 'Nov 16, 2026 Paid to SWIGGY ₹ 250 Txn. ID : T1 Txn. status : Successful Debited from : XXXX001111 Axis Bank Bank Ref. No. : 600000000001 Message : Hi',
      },
      {
        id: 'm7', from: 'credit_cards@icici.bank.in', subject: 'Amazon Pay ICICI Bank Credit Card Statement for the period October 13, 2026 to November 12, 2026', date: '2026-11-13T00:00:00Z', auth: passAuth('icici.bank.in'),
        body: 'Payment due by November 30, 2026 ICICI Bank Credit Card XX4444 Minimum Amount Due: ₹1,020.00 Total Amount Due: ₹20,208.10 Pay now',
      },
    )
    const r = env.fn('readInbox')() as { counts: Record<string, number> }
    expect(r.counts).toMatchObject({ txn: 2, receipt: 1, statement: 1, review: 1, blocked: 1, ignored: 1 })

    const rows = env.tab(TXN_TAB).slice(1)
    expect(rows).toHaveLength(3)
    const first = rows.find((x) => x[col('Email ID')] === 'm1')!
    expect(first.slice(col('Date'), col('Category') + 1)).toEqual(['2026-11-16', '20:45:24', 'axis-bank-1111', 'Debit', 250, 'SWIGGY', 'Food'])
    expect(first[col('Status')]).toBe('Verified')
    expect(rows.find((x) => x[col('Email ID')] === 'm6')![col('Status')]).toBe('Receipt')

    const review = env.tab(REVIEW_TAB).slice(1)
    expect(review.map((x) => x[4])).toEqual(['Blocked', 'Not parsed'])
    expect(review[0][6]).toBe('') // a blocked email's text is never stored
    expect(env.tab(STATEMENT_TAB).slice(1)[0].slice(1, 5)).toEqual(['icici-credit_card-4444', 20208.1, 1020, '2026-11-30'])

    // Date and ID columns are formatted as text before values go in
    expect(env.sheets[TXN_TAB].formats[`2,${col('Date') + 1}`]).toBe('@')

    // The search reads only allow-listed senders, from a date
    expect(env.queries[0]).toMatch(/^from:\(alerts@axis\.bank\.in OR .*\) after:\d+$/)
  })

  it('never adds the same email twice, and resumes from the last run', () => {
    const { env } = ready()
    env.messages.push(axisUpi('m1', '250.00', '600000000001'))
    env.fn('readInbox')()
    env.fn('readInbox')()
    expect(env.tab(TXN_TAB)).toHaveLength(2)
    expect(env.props.JHAPI_LAST_RUN).toBe('2026-11-17T10:00:00.000Z')
    env.clock.t += 600_000
    env.fn('readInbox')()
    const after = Number(/after:(\d+)/.exec(env.queries.at(-1)!)![1]) * 1000
    expect(after).toBe(Date.parse('2026-11-16T10:00:00Z')) // last run minus a day
  })

  it('skips a second alert for the same money (same reference) from another email', () => {
    const { env } = ready()
    env.messages.push(axisUpi('m1', '250.00', '600000000001'), axisUpi('m9', '250.00', '600000000001', { subject: 'INR 250.00 was debited from your A/c no. XX1111. ', date: '2026-11-16T15:20:00Z' }))
    const r = env.fn('readInbox')() as { counts: Record<string, number> }
    expect(r.counts.duplicate).toBe(1)
    expect(env.tab(TXN_TAB)).toHaveLength(2)
  })
})

describe('pull and push', () => {
  it('pull tidies a row typed by hand and returns it', () => {
    const { env, token } = ready()
    const row = Array(TXN_HEADERS.length).fill('')
    row[col('Date')] = '16/11/2026'
    row[col('Amount')] = 1500
    row[col('Type')] = 'debit'
    row[col('Counterparty')] = 'Milkman'
    env.sheets[TXN_TAB].grid.push(row)
    const r = env.call({ token, action: 'pull' })
    expect(r.ok).toBe(true)
    expect(r.transactions).toHaveLength(1)
    expect(r.transactions[0]).toMatchObject({ date: '2026-11-16', amountPaise: 150000, direction: 'debit', status: 'manual', source: 'sheet', counterparty: 'Milkman' })
    expect(r.transactions[0].id).toMatch(/[0-9a-f-]{36}/)
    // Written back in the standard layout, so the ID sticks
    expect(env.tab(TXN_TAB)[1][col('ID')]).toBe(r.transactions[0].id)
    expect(env.tab(TXN_TAB)[1][col('Date')]).toBe('2026-11-16')
  })

  it('pull reports rows it cannot read instead of guessing', () => {
    const { env, token } = ready()
    const row = Array(TXN_HEADERS.length).fill('')
    row[col('Date')] = 'someday'
    row[col('Amount')] = 10
    env.sheets[TXN_TAB].grid.push(row)
    expect(env.call({ token, action: 'pull' }).problems).toEqual(['Transactions row 2: missing or unreadable Date'])
  })

  const appTxn = (over: Record<string, unknown> = {}) => ({
    id: 'a1', date: '2026-11-17', time: '', account: 'axis-bank-1111', direction: 'debit', amountPaise: 45000, counterparty: 'Chai',
    category: 'Food', channel: 'other', reference: '', balancePaise: null, status: 'manual', source: 'app', note: '', emailId: '', template: '',
    updatedAt: '2026-11-17T10:00:00.000Z', deleted: false, ...over,
  })

  it('push adds and updates rows; an older edit loses to a newer one in the sheet', () => {
    const { env, token } = ready()
    let r = env.call({ token, action: 'push', transactions: [appTxn()], device: 'iPhone' })
    expect(r.ok).toBe(true)
    expect(r.transactions).toHaveLength(1)
    expect(env.tab(TXN_TAB)[1][col('Amount')]).toBe(450)

    r = env.call({ token, action: 'push', transactions: [appTxn({ amountPaise: 50000, updatedAt: '2026-11-17T11:00:00.000Z' })] })
    expect(r.transactions[0].amountPaise).toBe(50000)
    expect(env.tab(TXN_TAB)).toHaveLength(2)

    r = env.call({ token, action: 'push', transactions: [appTxn({ amountPaise: 1, updatedAt: '2026-11-17T10:30:00.000Z' })] })
    expect(r.rejected).toEqual(['a1'])
    expect(r.transactions[0].amountPaise).toBe(50000)
    expect(env.tab('Log').some((x) => /App saved 1 change\(s\) from iPhone/.test(String(x[1])))).toBe(true)
  })

  it('push checks everything first: one bad record changes nothing', () => {
    const { env, token } = ready()
    const r = env.call({ token, action: 'push', transactions: [appTxn(), appTxn({ id: 'a2', amountPaise: -5 })] })
    expect(r).toMatchObject({ ok: false, error: 'Transaction 2: bad amount.' })
    expect(env.tab(TXN_TAB)).toHaveLength(1)
  })

  it('push can mark a review item resolved', () => {
    const { env, token } = ready()
    env.messages.push({ id: 'm4', from: 'alerts@axis.bank.in', subject: 'INR 5.00 was debited from your A/c no. XX1111.', date: '2026-11-16T17:00:00Z', body: 'new layout', auth: passAuth('axis.bank.in') })
    env.fn('readInbox')()
    const item = env.call({ token, action: 'pull' }).review[0]
    const r = env.call({ token, action: 'push', review: [{ id: item.id, resolved: true, updatedAt: '2030-01-01T00:00:00.000Z' }] })
    expect(r.review[0].resolved).toBe(true)
  })
})

describe('hand edits in the sheet', () => {
  it('onEdit stamps the row with an ID and the time, but ignores the header and the stamp itself', () => {
    const { env } = ready()
    const sheet = env.sheets[TXN_TAB]
    const row = Array(TXN_HEADERS.length).fill('')
    row[col('Amount')] = 99
    sheet.grid.push(row)
    env.fn('onEdit')({ range: sheet.getRange(2, col('Amount') + 1) })
    expect(sheet.grid[1][col('ID')]).toMatch(/[0-9a-f-]{36}/)
    expect(sheet.grid[1][col('Updated')]).toBe('2026-11-17T10:00:00.000Z')
    const before = JSON.stringify(sheet.grid[0])
    env.fn('onEdit')({ range: sheet.getRange(1, 2) })
    expect(JSON.stringify(sheet.grid[0])).toBe(before)
  })
})

describe('DKIM check', () => {
  const raw = (auth: string, from = 'alerts@axis.bank.in') => `Authentication-Results: ${auth}\r\nFrom: ${from}\r\n\r\nbody`
  it('passes only for a Gmail-recorded signature from the bank domain', () => {
    expect(checkSender(raw(passAuth('axis.bank.in')), 'alerts@axis.bank.in', 'axis.bank.in').ok).toBe(true)
    expect(checkSender(raw(passAuth('mailer.axis.bank.in')), 'alerts@axis.bank.in', 'axis.bank.in').ok).toBe(true)
    expect(checkSender(raw(passAuth('evil.com')), 'alerts@axis.bank.in', 'axis.bank.in').ok).toBe(false)
    expect(checkSender(raw(passAuth('notaxis.bank.in')), 'alerts@axis.bank.in', 'axis.bank.in').ok).toBe(false)
    expect(checkSender(raw('attacker.example; dkim=pass header.i=@axis.bank.in'), 'alerts@axis.bank.in', 'axis.bank.in').ok).toBe(false)
    expect(checkSender('From: x\r\n\r\n', 'alerts@axis.bank.in', 'axis.bank.in').reason).toMatch(/No Authentication-Results/)
    expect(checkSender(raw(passAuth('axis.bank.in')), 'alerts@axis-bank.in', 'axis.bank.in').ok).toBe(false)
  })
  it('reads folded header lines', () => {
    const folded = 'Authentication-Results: mx.google.com;\r\n       dkim=pass header.i=@axis.bank.in header.s=s1;\r\n       spf=pass\r\nFrom: alerts@axis.bank.in\r\n\r\nx'
    expect(checkSender(folded, 'alerts@axis.bank.in', 'axis.bank.in').ok).toBe(true)
  })
})

describe('rules and tidying after an email run', () => {
  it('applies the owner\'s rules to new emails, and rules sync both ways', () => {
    const { env, token } = ready()
    env.sheets[RULES_TAB].grid.push(['', 'swiggy', 'Eating out', '', ''])
    env.messages.push(axisUpi('m1', '250.00', '600000000001'))
    env.fn('readInbox')()
    expect(env.tab(TXN_TAB)[1][col('Category')]).toBe('Eating out')
    const pulled = env.call({ token, action: 'pull' })
    expect(pulled.rules).toHaveLength(1)
    expect(pulled.rules[0]).toMatchObject({ contains: 'swiggy', category: 'Eating out', deleted: false })
    const r = env.call({ token, action: 'push', rules: [{ id: 'r2', contains: 'BESCOM', category: 'Bills', updatedAt: '2026-11-17T10:00:00.000Z', deleted: false }] })
    expect(r.rules.map((x: { contains: string }) => x.contains).sort()).toEqual(['BESCOM', 'swiggy'])
    expect(env.call({ token, action: 'push', rules: [{ id: 'r3', contains: '', category: 'X', updatedAt: '2026-11-17T10:00:00.000Z', deleted: false }] }).error).toMatch(/Rule 1/)
  })

  it('tags a transfer between two of the owner\'s accounts after the run', () => {
    const { env } = ready()
    env.messages.push(
      {
        id: 'd1', from: 'digibankalerts@dbs.com', subject: 'digibank alert – Funds transfer successful via UPI', date: '2026-11-16T10:56:00Z', auth: passAuth('dbs.com'),
        body: 'Your funds transfer request for INR 14000.00 on 16-Nov-2026 16:26 from your VPA asha@dbs linked to Account Number XXXXXXXX6666 to Payee VPA asha@axisbank has been completed via UPI (Ref No 600000000020) and the funds',
      },
      {
        id: 'a1', from: 'alerts@axis.bank.in', subject: 'INR 14,000.00 was credited to your A/c.', date: '2026-11-16T10:56:30Z', auth: passAuth('axis.bank.in'),
        body: 'Amount Credited: INR 14,000.00 Account Number: XX1111 Date & Time: 16-11-26, 16:26:30 IST Transaction Info: UPI/P2A/600000000020/ASHA RAO/DBSS/x Feel free to connect',
      },
    )
    env.fn('readInbox')()
    const rows = env.tab(TXN_TAB).slice(1)
    expect(rows.map((r) => r[col('Category')])).toEqual(['Transfer', 'Transfer'])
    expect(rows.find((r) => r[col('Email ID')] === 'd1')![col('Note')]).toBe('To Axis Bank ••1111')
    expect(env.tab('Log').some((x) => /tagged as transfers/.test(String(x[1])))).toBe(true)
  })
})

describe('holdings sync', () => {
  const ppf = {
    id: 'h1', type: 'ppf', name: 'PPF · SBI', institution: 'SBI', code: '', units: '', pricePaise: null, priceDate: '', investedPaise: 61500000,
    valuePaise: null, valueDate: '', ratePct: 7.1, startDate: '2026-04-01', maturityDate: '2034-03-31', compounding: '', payout: false,
    monthlyPaise: 1250000, tenureMonths: null, notes: '', updatedAt: '2026-11-17T10:00:00.000Z', deleted: false,
  }
  it('push writes a readable row; pull reads it back, including rows typed by hand', () => {
    const { env, token } = ready()
    let r = env.call({ token, action: 'push', holdings: [ppf] })
    expect(r.ok).toBe(true)
    expect(r.holdings).toEqual([ppf])
    const row = env.tab('Holdings')[1]
    expect(row.slice(0, 3)).toEqual(['h1', 'PPF · SBI', 'PPF'])
    expect(row[8]).toBe(615000) // Invested in rupees
    env.sheets.Holdings.grid.push(['', 'Flat', 'Property', '', '', '', '', '', '', 6000000, '01/06/2026', '', '', '', '', '', '', '', '', '', ''])
    env.sheets.Holdings.grid.push(['', 'Mystery', 'Bitcoin', '', '', '', '', '', '', 10, '', '', '', '', '', '', '', '', '', '', ''])
    r = env.call({ token, action: 'pull' })
    expect(r.holdings).toHaveLength(2)
    expect(r.holdings[1]).toMatchObject({ type: 'property', name: 'Flat', valuePaise: 600000000, valueDate: '2026-06-01' })
    expect(r.problems).toEqual(['Holdings row 4: unknown Type "Bitcoin"'])
  })
  it('refuses a holding with a bad type or number', () => {
    const { env, token } = ready()
    expect(env.call({ token, action: 'push', holdings: [{ ...ppf, type: 'crypto' }] }).error).toBe('Holding 1: bad type.')
    expect(env.call({ token, action: 'push', holdings: [{ ...ppf, ratePct: 'high' }] }).error).toBe('Holding 1: bad ratePct.')
  })
})

describe('prices and net worth', () => {
  const holding = (p: Record<string, unknown>) => ({
    id: 'h', type: 'mf', name: 'Fund', institution: '', code: '', units: '', pricePaise: null, priceDate: '', investedPaise: null,
    valuePaise: null, valueDate: '', ratePct: null, startDate: '', maturityDate: '', compounding: '', payout: false, monthlyPaise: null,
    tenureMonths: null, notes: '', updatedAt: '2026-11-17T09:00:00.000Z', deleted: false, ...p,
  })

  it('updates fund NAVs from AMFI and stocks from GOOGLEFINANCE, then saves today\'s net worth', () => {
    const { env, token } = ready()
    env.call({
      token, action: 'push', holdings: [
        holding({ id: 'f', code: '100001', units: '100' }),
        holding({ id: 's', type: 'stock', name: 'TCS', code: 'tcs', units: '10' }),
        holding({ id: 'x', type: 'stock', name: 'Gone', code: 'NOPE', units: '1' }),
        holding({ id: 'p', type: 'property', name: 'Flat', valuePaise: 600000000 }),
      ],
    })
    env.web['https://www.amfiindia.com/spages/NAVAll.txt'] = { code: 200, body: 'Scheme Code;a;b;Name;Net Asset Value;Date\n100001;x;-;Example Fund;87.6543;14-Nov-2026\n' }
    env.quotes['NSE:TCS'] = 4123.45
    const r = env.call({ token, action: 'refreshPrices' })
    expect(r.ok).toBe(true)
    const byId = Object.fromEntries(r.holdings.map((h: { id: string }) => [h.id, h]))
    expect(byId.f).toMatchObject({ pricePaise: 8765, priceDate: '2026-11-14' })
    expect(byId.s).toMatchObject({ pricePaise: 412345, priceDate: '2026-11-17' })
    expect(byId.x.pricePaise).toBeNull()
    // Net worth: 100 × 87.65 + 10 × 4,123.45 + 60,00,000
    expect(r.netWorth).toEqual([expect.objectContaining({ date: '2026-11-17', netPaise: 876500 + 4123450 + 600000000 })])
    expect(env.tab('Log').some((x) => /Prices: 2 holding\(s\) updated \(no price for NSE:NOPE\)/.test(String(x[1])))).toBe(true)

    // Run again the same day: the net worth row is replaced, not added
    env.call({ token, action: 'refreshPrices' })
    expect(env.tab('Net worth')).toHaveLength(2)
  })

  it('does not fetch AMFI when no fund has a scheme code, and copes with AMFI being down', () => {
    const { env, token } = ready()
    env.call({ token, action: 'refreshPrices' })
    expect(env.fetched).toEqual([])
    env.call({ token, action: 'push', holdings: [holding({ id: 'f', code: '100001', units: '1' })] })
    const r = env.call({ token, action: 'refreshPrices' })
    expect(r.ok).toBe(true)
    expect(env.tab('Log').some((x) => /AMFI NAVs not fetched \(HTTP 404\)/.test(String(x[1])))).toBe(true)
  })
})

describe('goals sync', () => {
  const g = {
    id: 'g1', name: 'College', costTodayPaise: 250000000, targetYear: 2036, inflationPct: 6, returnPct: null, sipPaise: 600000,
    tags: [{ holdingId: 'h1', pct: 50 }], notes: '', updatedAt: '2026-11-17T10:00:00.000Z', deleted: false,
  }
  it('push writes readable columns; hand-typed goals are read back', () => {
    const { env, token } = ready()
    const r = env.call({ token, action: 'push', goals: [g] })
    expect(r.goals).toEqual([g])
    expect(env.tab('Goals')[1].slice(1, 8)).toEqual(['College', 2500000, 2036, 6, '', 6000, 'h1:50'])
    env.sheets.Goals.grid.push(['', 'Car', 800000, 2029, '', '', '', '', '', '', ''])
    env.sheets.Goals.grid.push(['', 'No year', 100, '', '', '', '', '', '', '', ''])
    const p = env.call({ token, action: 'pull' })
    expect(p.goals[1]).toMatchObject({ name: 'Car', costTodayPaise: 80000000, targetYear: 2029, inflationPct: 6, sipPaise: 0 })
    expect(p.problems).toEqual(['Goals row 4: missing or unreadable Target year'])
  })
  it('refuses a share over 100% or an id that would break the Holdings cell', () => {
    const { env, token } = ready()
    expect(env.call({ token, action: 'push', goals: [{ ...g, tags: [{ holdingId: 'h1', pct: 120 }] }] }).error).toBe('Goal 1: bad holding share.')
    expect(env.call({ token, action: 'push', goals: [{ ...g, tags: [{ holdingId: 'a:b', pct: 10 }] }] }).error).toBe('Goal 1: bad holding share.')
  })
})
