// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('app shell', () => {
  it('shows the four tabs and switches page', async () => {
    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>,
    )
    expect(screen.getByRole('heading', { name: 'Net worth' })).toBeInTheDocument()
    for (const name of ['Home', 'Transactions', 'Invest', 'Settings']) {
      expect(screen.getByRole('link', { name })).toBeInTheDocument()
    }
    await userEvent.click(screen.getByRole('link', { name: 'Transactions' }))
    expect(screen.getByRole('heading', { name: 'Transactions' })).toBeInTheDocument()
  })
})
