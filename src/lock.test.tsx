// @vitest-environment jsdom
/**
 * The passkey lock end to end: the real app, store and built cloud/Code.gs on fake Google, with a
 * fake passkey (jsdom has no WebAuthn). Checks that nothing readable stays on the device once the
 * lock is on, and that locking, unlocking, turning off and starting again all work.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import { makeEnv, passAuth } from './cloud/fakeGoogle'
import { LockGate } from './data/lock'
import { LocalStore, memoryKV, type KV } from './data/localStore'
import { PasskeyError, type PasskeyApi } from './data/passkey'
import type { Transport } from './data/sheetClient'
import { StoreProvider } from './data/store'
import { LOCK_KEY, VAULT_PREFIX, randomBytes } from './data/vault'

const URL = 'https://script.google.com/macros/s/AKfyc-test_123/exec'

function fakePasskeys() {
  const secrets = new Map<string, Uint8Array<ArrayBuffer>>()
  let n = 0
  const api: PasskeyApi = {
    supported: () => true,
    async create() {
      const credentialId = `cred${++n}`
      const secret = randomBytes(32)
      secrets.set(credentialId, secret)
      return { credentialId, salt: 'c2FsdA==', secret }
    },
    async unlock(id) {
      const s = secrets.get(id)
      if (!s) throw new PasskeyError('cancelled', 'The passkey was cancelled or timed out. Try again.')
      return s
    },
  }
  return { api, secrets }
}

function setup(raw: KV = memoryKV()) {
  const env = makeEnv()
  env.fn('setup')()
  env.messages.push({
    id: 'm1',
    from: 'Axis Bank Alerts <alerts@axis.bank.in>',
    subject: 'INR 480.00 was debited from your A/c no. XX1111.',
    date: '2026-11-16T15:15:25Z',
    body: 'Amount Debited: INR 480.00 Account Number: XX1111 Date & Time: 16-11-26, 20:45:24 IST Transaction Info: UPI/P2M/600000000001/SWIGGY If this transaction was not initiated by you:',
    auth: passAuth('axis.bank.in'),
  })
  env.fn('readInbox')()
  new LocalStore(raw).setConfig({ url: URL, token: env.props.JHAPI_TOKEN })
  const transport: Transport = async (_url, body) => JSON.stringify(env.call(JSON.parse(body)))
  const passkeys = fakePasskeys()
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <LockGate raw={raw} passkeys={passkeys.api}>
        {(local) => (
          <StoreProvider local={local} transport={transport}>
            <App />
          </StoreProvider>
        )}
      </LockGate>
    </MemoryRouter>,
  )
  return { raw, passkeys }
}

const readable = (raw: KV) => raw.keys!().filter((k) => /SWIGGY|script\.google|"token"/.test(raw.get(k) ?? ''))

function setVisibility(v: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-11-17T12:00:00Z'))
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('passkey lock', () => {
  it('encrypts the device copy, locks, unlocks and turns off', async () => {
    const user = userEvent.setup()
    const { raw } = setup()
    expect(await screen.findByText('Transactions in the sheet')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: 'Transactions' }))
    expect(await screen.findByText('SWIGGY')).toBeInTheDocument()
    expect(readable(raw).length).toBeGreaterThan(0)

    await user.click(screen.getByRole('link', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Turn on passkey lock' }))
    expect(await screen.findByText(/On\. The copy of your data on this device is encrypted/)).toBeInTheDocument()
    expect(screen.getByText(/“Jhapi on Browser” in Passwords/)).toBeInTheDocument()

    // Nothing readable is left in storage, and the app still works from the encrypted copy.
    expect(raw.get(LOCK_KEY)).not.toBeNull()
    expect(raw.get('jhapi.snapshot')).toBeNull()
    expect(readable(raw)).toEqual([])
    await user.click(screen.getByRole('link', { name: 'Transactions' }))
    expect(await screen.findByText('SWIGGY')).toBeInTheDocument()

    // Lock now → lock screen; nothing of the data shows; the passkey opens it again.
    await user.click(screen.getByRole('link', { name: 'Settings' }))
    await user.click(screen.getByRole('button', { name: 'Lock now' }))
    expect(await screen.findByRole('heading', { name: 'Jhapi is locked' })).toBeInTheDocument()
    expect(screen.queryByText('SWIGGY')).toBeNull()
    expect(screen.queryByRole('link', { name: 'Transactions' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Unlock with passkey' }))
    expect(await screen.findByText('Transactions in the sheet')).toBeInTheDocument()
    expect(readable(raw)).toEqual([])

    // Turn off → plain again, no lock record, no encrypted copies.
    await user.click(screen.getByRole('button', { name: 'Turn off' }))
    expect(await screen.findByRole('button', { name: 'Turn on passkey lock' })).toBeInTheDocument()
    expect(raw.get(LOCK_KEY)).toBeNull()
    expect(raw.keys!().some((k) => k.startsWith(VAULT_PREFIX))).toBe(false)
    expect(new LocalStore(raw).config()?.url).toBe(URL)
  })

  it('locks after 5 minutes in the background, not before', async () => {
    const user = userEvent.setup()
    setup()
    await user.click(await screen.findByRole('button', { name: 'Turn on passkey lock' }))
    await screen.findByRole('button', { name: 'Lock now' })

    act(() => setVisibility('hidden'))
    vi.setSystemTime(new Date('2026-11-17T12:04:00Z'))
    act(() => setVisibility('visible'))
    expect(screen.queryByRole('heading', { name: 'Jhapi is locked' })).toBeNull()

    act(() => setVisibility('hidden'))
    vi.setSystemTime(new Date('2026-11-17T12:10:00Z'))
    act(() => setVisibility('visible'))
    expect(await screen.findByRole('heading', { name: 'Jhapi is locked' })).toBeInTheDocument()
  })

  it('opens locked after a reload, refuses the wrong passkey, and can start again without one', async () => {
    const user = userEvent.setup()
    const { raw, passkeys } = setup()
    await user.click(await screen.findByRole('button', { name: 'Turn on passkey lock' }))
    await screen.findByRole('button', { name: 'Lock now' })
    cleanup()

    // "Reload": a fresh app on the same storage starts on the lock screen.
    const secrets = passkeys.secrets
    const again = fakePasskeys()
    for (const [id] of secrets) again.secrets.set(id, randomBytes(32)) // a different passkey's secret
    render(
      <MemoryRouter initialEntries={['/']}>
        <LockGate raw={raw} passkeys={again.api}>
          {(local) => (
            <StoreProvider local={local} transport={async () => '{"ok":false}'}>
              <App />
            </StoreProvider>
          )}
        </LockGate>
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Jhapi is locked' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Unlock with passkey' }))
    expect((await screen.findByRole('alert')).textContent).toContain("doesn't open Jhapi on this device")

    await user.click(screen.getByText("Can't use your passkey?"))
    await user.click(screen.getByRole('button', { name: "Forget this device's copy" }))
    expect(await screen.findByRole('heading', { name: 'Welcome to Jhapi' })).toBeInTheDocument()
    expect(raw.keys!()).toEqual([])
  })
})
