import { NavLink, Route, Routes } from 'react-router-dom'
import Home from './pages/Home.tsx'
import { Placeholder } from './pages/Placeholder.tsx'
import Settings from './pages/Settings.tsx'
import Transactions from './pages/Transactions.tsx'
import TxnEdit from './pages/TxnEdit.tsx'

const TABS = [
  { to: '/', label: 'Home', icon: 'M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z' },
  { to: '/transactions', label: 'Transactions', icon: 'M4 6h16M4 12h16M4 18h10' },
  { to: '/portfolio', label: 'Invest', icon: 'M3 17l6-6 4 4 8-8M15 7h6v6' },
  { to: '/settings', label: 'Settings', icon: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2' },
]

export default function App() {
  return (
    <div className="shell">
      <main className="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/transactions" element={<Transactions />} />
          <Route path="/transactions/new" element={<TxnEdit key="new" />} />
          <Route path="/transactions/:id" element={<TxnEdit />} />
          <Route path="/portfolio" element={<Placeholder title="Portfolio" milestone="M5" />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Placeholder title="Not found" />} />
        </Routes>
      </main>
      <nav aria-label="Main" className="tabs">
        {TABS.map((t) => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'} className="tab">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d={t.icon} />
            </svg>
            {t.label}
          </NavLink>
        ))}
      </nav>
    </div>
  )
}
