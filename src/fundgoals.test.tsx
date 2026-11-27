// @vitest-environment jsdom
/**
 * Purchases from fund emails moving goals, and the Funds & goals screen: the real screens and store, the
 * built cloud/Code.gs on fake Google.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { makeEnv, passAuth } from './cloud/fakeGoogle'
import { COIN, KFIN } from './core/fundBuys.fixture'
import { LocalStore, memoryKV } from './data/localStore'
import type { Transport } from './data/sheetClient'
import { StoreProvider } from './data/store'

const URL = 'https://script.google.com/macros/s/AKfyc-test_123/exec'
const T = '2026-11-01T09:00:00.000Z'

function setup() {
  const env = makeEnv()
  env.fn('setup')()
  const H = env.sheets.Holdings.grid
  // ID, Name, Type, Institution, Code, Units, Price, Price date, Invested, Value, Value date, Rate %, Start, Maturity, Compounding, Payout, Monthly, Months, Notes, Updated, Deleted, Units date
  H.push(['value', 'Example Value Index Fund - Direct Plan - Growth', 'Mutual fund', '', 'INF000X01011', '100', 30, '2026-11-14', 3000, '', '', '', '', '', '', '', 14000, '', 'Folio 910000000001 · from CAS', T, '', '2026-10-31'])
  H.push(['contra', 'Sample Contra Fund - Direct Plan - Growth', 'Mutual fund', '', '', '50', 200, '2026-11-14', 9000, '', '', '', '', '', '', '', 21000, '', '', T, '', ''])
  // ID, Name, Cost today, Target year, Inflation %, Return %, Monthly SIP, Holdings, Notes, Updated, Deleted, Top-up %
  env.sheets.Goals.grid.push(['g1', 'College', 2500000, 2036, 6, '', 0, 'value:100', '', T, '', 10])
  env.sheets.Goals.grid.push(['g2', 'Home', 5000000, 2032, 6, '', 0, '', '', T, '', 10])
  env.messages.push(
    { id: 'c1', from: COIN.from, subject: COIN.subject, date: COIN.receivedAt, body: COIN.text, auth: passAuth('zerodha.net') },
    { id: 'k1', from: KFIN.from, subject: KFIN.subject, date: KFIN.receivedAt, body: KFIN.text, auth: passAuth('kfintech.com') },
  )
  env.fn('readInbox')()
  const local = new LocalStore(memoryKV())
  local.setConfig({ url: URL, token: env.props.JHAPI_TOKEN })
  const transport: Transport = async (_url, body) => JSON.stringify(env.call(JSON.parse(body)))
  render(
    <MemoryRouter initialEntries={['/goals/funds']}>
      <StoreProvider local={local} transport={transport}>
        <App />
      </StoreProvider>
    </MemoryRouter>,
  )
  return { env }
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-17T12:00:00Z'))
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('funds and goals', () => {
  it('shows purchases added from emails with the goals moved, and maps funds to goals in one place', async () => {
    const user = userEvent.setup()
    const { env } = setup()

    // Both purchases were added once each (the KFintech copy of the value-fund purchase was a duplicate).
    const buys = within((await screen.findByRole('heading', { name: 'Purchases from emails' })).closest('section')!)
    expect(buys.getByText('+528.591 units')).toBeInTheDocument()
    expect(buys.getByText('+118.713 units')).toBeInTheDocument()
    expect(buys.getAllByText(/Added/)).toHaveLength(2)
    // College holds all of the value fund: 628.591 units × ₹30.
    expect(screen.getByText(/₹18,858 set aside · SIP ₹14,000\/month/)).toBeInTheDocument()

    // Give the contra fund to Home in one go, then split the value fund 60/40.
    await user.selectOptions(screen.getByLabelText('Give all of Sample Contra Fund - Direct Plan - Growth to a goal'), 'g2')
    await user.clear(screen.getByLabelText('Share of Example Value Index Fund - Direct Plan - Growth for College, percent'))
    await user.type(screen.getByLabelText('Share of Example Value Index Fund - Direct Plan - Growth for College, percent'), '60')
    await user.type(screen.getByLabelText('Share of Example Value Index Fund - Direct Plan - Growth for Home, percent'), '50')
    expect(screen.getByRole('alert').textContent).toMatch(/more than 100% set aside/)
    expect(screen.getByRole('button', { name: 'Save 2 goals' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Share of Example Value Index Fund - Direct Plan - Growth for Home, percent'))
    await user.type(screen.getByLabelText('Share of Example Value Index Fund - Direct Plan - Growth for Home, percent'), '40')
    expect(screen.getAllByText('Not set aside: 0%')).toHaveLength(2)
    await user.click(screen.getByRole('button', { name: 'Save 2 goals' }))

    await screen.findByRole('heading', { name: 'Goals' })
    await waitFor(() => {
      const rows = Object.fromEntries(env.tab('Goals').slice(1).map((r) => [r[0], r[7]]))
      expect(rows.g1).toBe('value:60')
      expect(String(rows.g2).split('; ').sort()).toEqual(['contra:100', 'value:40'])
    })
  })
})
