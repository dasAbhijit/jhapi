import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// Served from https://dasabhijit.github.io/jhapi/
export default defineConfig({
  base: '/jhapi/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // Registered from main.tsx, so the app can also check for a new version each time it comes back.
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Jhapi',
        short_name: 'Jhapi',
        description: 'Your money in one place: spending from bank emails, investments, loans and goals',
        theme_color: '#16004d',
        background_color: '#f0f0f5',
        display: 'standalone',
        start_url: '/jhapi/',
        scope: '/jhapi/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: 'icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Only the app shell is cached. Data lives in the encrypted vault (IndexedDB), not in the service worker.
        navigateFallback: '/jhapi/index.html',
      },
    }),
  ],
})
