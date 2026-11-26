// @vitest-environment jsdom
/**
 * CAS import end to end: the real screens and store, the built cloud/Code.gs on fake Google, and
 * then the morning price run finding the imported funds by ISIN. pdf.js itself is tested in
 * src/data/pdfText.test.ts; here the PDF's text is given directly.
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { makeEnv } from './cloud/fakeGoogle'
import { LocalStore, memoryKV } from './data/localStore'
import type { Transport } from './data/sheetClient'
import { StoreProvider } from './data/store'

const STATEMENT = `Consolidated Account Statement
01-Jan-2020 To 16-Nov-2026
Example Mutual Fund
Folio No: 1234567 / 89 PAN: ABCDE1234F
X123-Example Flexi Cap Fund - Direct Plan - Growth (Non-Demat) - ISIN: INF000A01AB1(Advisor: DIRECT) Registrar : CAMS
Closing Unit Balance: 150.000 NAV on 14-Nov-2026: INR 100.0000 Total Cost Value: 12,000.00 Market Value on 14-Nov-2026: INR 15,000.00
Folio No: 5555 PAN: ABCDE1234F
Y9-Example Liquid Fund - Direct Plan - Growth - ISIN: INF000B02CD7 Registrar : KFINTECH
Closing Unit Balance: 2.500 NAV on 14-Nov-2026: INR 2,000.0000 Total Cost Value: 4,900.00 Market Value on 14-Nov-2026: INR 5,000.00`

vi.mock('./data/pdfText', async (orig) => {
  const real = await orig<typeof import('./data/pdfText')>()
  return {
    ...real,
    pdfLines: async (_data: ArrayBuffer, password: string) => {
      if (password.trim() !== 'ABCDE1234F') throw new real.PdfPasswordError(password !== '')
      return STATEMENT.split('\n')
    },
  }
})

const URL = 'https://script.google.com/macros/s/AKfyc-test_123/exec'

function setup() {
  const env = makeEnv()
  env.fn('setup')()
  // A fund added by hand earlier, with its AMFI scheme code and old units.
  env.sheets.Holdings.grid.push(['h1', 'My flexi cap', 'Mutual fund', '', '100001', '100', 9500, '2026-11-10', 10000, '', '', '', '', '', '', '', '', '', 'SIP 5k', '2026-11-17T09:00:00.000Z', ''])
  const local = new LocalStore(memoryKV())
  local.setConfig({ url: URL, token: env.props.JHAPI_TOKEN })
  const transport: Transport = async (_url, body) => JSON.stringify(env.call(JSON.parse(body)))
  render(
    <MemoryRouter initialEntries={['/portfolio']}>
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

describe('CAS import', () => {
  it('reads the statement, updates the matching fund, adds the new one, and prices both by ISIN every morning', async () => {
    const user = userEvent.setup()
    const { env } = setup()
    await screen.findByText('My flexi cap')
    await user.click(screen.getByRole('link', { name: 'Import CAS' }))

    // jsdom's File has no arrayBuffer(); Safari's does.
    const file = Object.assign(new File(['%PDF-1.7'], 'cas.pdf', { type: 'application/pdf' }), { arrayBuffer: async () => new ArrayBuffer(8) })
    await user.upload(screen.getByLabelText('CAS PDF'), file)
    await user.type(screen.getByLabelText('PDF password'), 'WRONG')
    await user.click(screen.getByRole('button', { name: 'Read statement' }))
    expect((await screen.findByRole('alert')).textContent).toContain('usually your PAN')

    await user.clear(screen.getByLabelText('PDF password'))
    await user.type(screen.getByLabelText('PDF password'), 'ABCDE1234F')
    await user.click(screen.getByRole('button', { name: 'Read statement' }))
    expect(await screen.findByText('₹20,000')).toBeInTheDocument()
    expect(screen.getByText('2 funds')).toBeInTheDocument()

    // The flexi cap fund has no ISIN in Jhapi yet and a different name, so it is offered as new; point it at the existing one.
    const flexi = screen.getByLabelText('What to do with Example Flexi Cap Fund - Direct Plan - Growth')
    expect((flexi as HTMLSelectElement).value).toBe('+new')
    await user.selectOptions(flexi, 'h1')
    expect((screen.getByLabelText('What to do with Example Liquid Fund - Direct Plan - Growth') as HTMLSelectElement).value).toBe('+new')
    await user.click(screen.getByRole('button', { name: 'Import 2 holdings' }))

    await screen.findByRole('heading', { name: 'Portfolio' })
    expect(screen.getByText('My flexi cap')).toBeInTheDocument()
    expect(screen.getByText('Example Liquid Fund - Direct Plan - Growth')).toBeInTheDocument()
    await waitFor(() => {
      const rows = env.tab('Holdings').slice(1)
      expect(rows).toHaveLength(2)
      const mine = rows.find((r) => r[0] === 'h1')!
      // ID, Name, Type, Institution, Code, Units, Price, Price date, Invested … Notes
      expect(mine.slice(0, 9)).toEqual(['h1', 'My flexi cap', 'Mutual fund', 'Example Mutual Fund', 'INF000A01AB1', '150', 100, '2026-11-14', 12000])
      expect(mine[18]).toBe('SIP 5k')
      const added = rows.find((r) => r[0] !== 'h1')!
      expect(added.slice(1, 9)).toEqual(['Example Liquid Fund - Direct Plan - Growth', 'Mutual fund', 'Example Mutual Fund', 'INF000B02CD7', '2.5', 2000, '2026-11-14', 4900])
      expect(added[18]).toBe('Folio 5555 · from CAS')
    })

    // The next morning: AMFI's file, matched by ISIN.
    env.web['https://www.amfiindia.com/spages/NAVAll.txt'] = {
      code: 200,
      body: 'Scheme Code;ISIN Div Payout/ ISIN Growth;ISIN Div Reinvestment;Scheme Name;Net Asset Value;Date\n100001;INF000A01AB1;-;Example Flexi Cap Fund - Direct Plan - Growth;101.5000;17-Nov-2026\n200002;INF000B02CD7;-;Example Liquid Fund;2001.0000;17-Nov-2026\n',
    }
    env.fn('refreshPrices')()
    const rows = env.tab('Holdings').slice(1)
    expect(rows.map((r) => [r[4], r[6], r[7]])).toEqual([
      ['INF000A01AB1', 101.5, '2026-11-17'],
      ['INF000B02CD7', 2001, '2026-11-17'],
    ])
  })
})
