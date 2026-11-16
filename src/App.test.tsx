// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from './App'
import { LocalStore, memoryKV } from './data/localStore'
import { StoreProvider } from './data/store'

describe('app shell', () => {
  it('shows the four tabs, asks to connect, and opens Settings', async () => {
    render(
      <MemoryRouter>
        <StoreProvider local={new LocalStore(memoryKV())}>
          <App />
        </StoreProvider>
      </MemoryRouter>,
    )
    for (const name of ['Home', 'Transactions', 'Invest', 'Settings']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument()
    }
    expect(screen.getByRole('heading', { name: 'Welcome to Jhapi' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('link', { name: 'Connect your sheet' }))
    expect(screen.getByRole('heading', { name: 'Your Jhapi sheet' })).toBeInTheDocument()
  })
})
