/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

const srcDir = fileURLToPath(new URL('./src', import.meta.url)).replace(/^[a-z]:/, (d) => d.toUpperCase());

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Ask before reloading, so an update never interrupts someone mid-entry.
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'favicon.ico', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'BudgetFlow',
        short_name: 'BudgetFlow',
        description: 'Track income, expenses, budgets, savings and Susu records across currencies.',
        lang: 'en-GH',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'any',
        theme_color: '#0F6B66',
        background_color: '#E3E8ED',
        categories: ['finance', 'productivity'],
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // The app shell only. API responses carry personal financial data and are never cached
        // by the service worker: /api requests always go to the network.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
        // Background Sync: wakes open BudgetFlow tabs to send queued records (see public/sw-sync.js).
        importScripts: ['sw-sync.js'],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    // The entry chunk is mostly framework code (React, router, query, forms, UI), about 200 kB
    // gzipped; pages load on demand. Custom codeSplitting groups were tried and dropped: Rolldown
    // then emitted React twice and hooks failed in production.
    chunkSizeWarningLimit: 700,
  },
  resolve: {
    // Upper-case the Windows drive letter: if the config loads as file:///c:/ while the root is C:\,
    // files reached through '@/' get different ids and Rolldown bundles libraries (React, the
    // router) twice, which breaks hooks and context in production.
    alias: { '@': srcDir },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    // Same-origin in development so the SameSite=Strict refresh cookie works.
    proxy: { '/api': { target: 'http://localhost:4000', changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    alias: { 'virtual:pwa-register/react': fileURLToPath(new URL('./src/test/stubs/pwa-register-react.ts', import.meta.url)) },
  },
});
