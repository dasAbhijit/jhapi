// @vitest-environment jsdom
/**
 * End to end without the network: the real screens and store, talking to the BUILT cloud/Code.gs
 * running against fake Google services.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { makeEnv, passAuth } from './cloud/fakeGoogle'
import { RULES_TAB, TXN_HEADERS, TXN_TAB } from './core/sheetRows'
import { LocalStore, memoryKV } from './data/localStore'
import type { Transport } from './data/sheetClient'
import { StoreProvider } from './data/store'

const URL = 'https://script.google.com/macros/s/AKfyc-test_123/exec'

function setup() {
  const env = makeEnv()
  env.fn('setup')()
  const token = env.props.JHAPI_TOKEN
  // Today in the fake clock is 17 Nov 2026; this email is from this month.
  env.messages.push({
    id: 'm1',
    from: 'Axis Bank Alerts <alerts@axis.bank.in>',
    subject: 'INR 480.00 was debited from your A/c no. XX1111.',
    date: '2026-11-16T15:15:25Z',
    body: 'Amount Debited: INR 480.00 Account Number: XX1111 Date & Time: 16-11-26, 20:45:24 IST Transaction Info: UPI/P2M/600000000001/SWIGGY If this transaction was not initiated by you:',
    auth: passAuth('axis.bank.in'),
  })
  env.fn('readInbox')()
  let calls = 0
  const transport: Transport = async (url, body) => {
    calls++
    expect(url).toBe(URL)
    return JSON.stringify(env.call(JSON.parse(body)))
  }
  const local = new LocalStore(memoryKV())
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <StoreProvider local={local} transport={transport}>
        <App />
      </StoreProvider>
    </MemoryRouter>,
  )
  return { env, token, local, calls: () => calls }
}

// The app's clock is pinned just after the fake Google clock (17 Nov 2026, 10:00 UTC), so app edits
// are newer than the rows the script wrote, and "this month" does not depend on when the tests run.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-17T12:00:00Z'))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('app and sheet round trip', () => {
  it('connects, shows email transactions, and saves a hand-added one to the sheet', async () => {
    const user = userEvent.setup()
    const { env, token, local } = setup()

    // A wrong code is refused with a clear message, and nothing is saved on the device.
    await user.type(screen.getByLabelText('Web app URL'), URL)
    await user.type(screen.getByLabelText('Secret code'), 'f'.repeat(64))
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Wrong secret code')
    expect(local.config()).toBeNull()

    await user.clear(screen.getByLabelText('Secret code'))
    await user.type(screen.getByLabelText('Secret code'), token)
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    expect(await screen.findByText('Transactions in the sheet')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: 'Transactions' }))
    expect(await screen.findByText('SWIGGY')).toBeInTheDocument()

    await user.click(screen.getByRole('link', { name: '+ Add' }))
    await user.type(screen.getByLabelText('Amount (₹)'), '1,250.50')
    await user.type(screen.getByLabelText('Paid to / received from'), 'Milkman')
    await user.selectOptions(screen.getByLabelText('Category'), 'Groceries')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    // Shown at once, and written to the sheet by the push.
    expect(await screen.findByText('Milkman')).toBeInTheDocument()
    await waitFor(() => {
      const rows = env.tab(TXN_TAB).slice(1)
      expect(rows).toHaveLength(2)
      const r = rows.find((x) => x[TXN_HEADERS.indexOf('Counterparty')] === 'Milkman')!
      expect(r[TXN_HEADERS.indexOf('Amount')]).toBe(1250.5)
      expect(r[TXN_HEADERS.indexOf('Category')]).toBe('Groceries')
      expect(r[TXN_HEADERS.indexOf('Source')]).toBe('App')
    })
    await waitFor(() => expect(local.pending().transactions).toHaveLength(0))

    // Home adds this month's spending: 480 + 1,250.50 → ₹1,731 (rounded for display)
    await user.click(screen.getByRole('link', { name: 'Home' }))
    const hero = (await screen.findByText(/Spent in November/)).closest('header')!
    expect(within(hero).getByText('₹1,731')).toBeInTheDocument()
  })

  it('a row typed into the sheet by hand shows up in the app after a sync', async () => {
    const user = userEvent.setup()
    const { env, token } = setup()
    await user.type(screen.getByLabelText('Web app URL'), URL)
    await user.type(screen.getByLabelText('Secret code'), token)
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    await screen.findByText('Transactions in the sheet')

    const row = Array(TXN_HEADERS.length).fill('')
    row[TXN_HEADERS.indexOf('Date')] = '15/11/2026'
    row[TXN_HEADERS.indexOf('Amount')] = 300
    row[TXN_HEADERS.indexOf('Type')] = 'Debit'
    row[TXN_HEADERS.indexOf('Counterparty')] = 'Newspaper'
    env.sheets[TXN_TAB].grid.push(row)

    await user.click(screen.getByRole('button', { name: 'Sync now' }))
    await user.click(screen.getByRole('link', { name: 'Transactions' }))
    expect(await screen.findByText('Newspaper')).toBeInTheDocument()
  })

  it('"Always use this category" saves a rule to the sheet and recategorises the payee', async () => {
    const user = userEvent.setup()
    const { env, token } = setup()
    await user.type(screen.getByLabelText('Web app URL'), URL)
    await user.type(screen.getByLabelText('Secret code'), token)
    await user.click(screen.getByRole('button', { name: 'Connect' }))
    await screen.findByText('Transactions in the sheet')

    await user.click(screen.getByRole('link', { name: 'Transactions' }))
    await user.click(await screen.findByText('SWIGGY'))
    await user.selectOptions(screen.getByLabelText('Category'), 'Entertainment')
    await user.click(screen.getByLabelText(/Always use Entertainment for “SWIGGY”/))
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const rules = env.tab(RULES_TAB).slice(1)
      expect(rules).toHaveLength(1)
      expect(rules[0].slice(1, 3)).toEqual(['SWIGGY', 'Entertainment'])
      expect(env.tab(TXN_TAB)[1][TXN_HEADERS.indexOf('Category')]).toBe('Entertainment')
    })
    await user.click(screen.getByRole('link', { name: 'Settings' }))
    expect(await screen.findByText(/“SWIGGY” →/)).toBeInTheDocument()
  })
})
