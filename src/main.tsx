import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import { StoreProvider } from './data/store.tsx'
import './index.css'
import { registerSW } from 'virtual:pwa-register'

// New versions install in the background and the page reloads into them (autoUpdate). Safari keeps a
// tab alive for days, so also look for a new version every time the app comes back to the foreground.
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    if (!reg) return
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void reg.update()
    })
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
      <StoreProvider>
        <App />
      </StoreProvider>
    </BrowserRouter>
  </StrictMode>,
)
