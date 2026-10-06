import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

const keyPath = resolve(process.cwd(), 'certs/key.pem')
const certPath = resolve(process.cwd(), 'certs/cert.pem')
const https =
  existsSync(keyPath) && existsSync(certPath)
    ? { key: readFileSync(keyPath), cert: readFileSync(certPath) }
    : undefined

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'EasyCNC',
        short_name: 'EasyCNC',
        description: "Pilotage et FAO web d'une CNC GRBL",
        theme_color: '#0b0e13',
        background_color: '#0b0e13',
        display: 'standalone',
        start_url: '.',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
    https,
  },
  preview: {
    host: true,
    port: 4173,
    https,
  },
  build: {
    target: 'es2021',
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react'
          if (id.includes('opentype') || id.includes('cam/fonts')) return 'fonts'
          if (id.includes('clipper-lib')) return 'clipper'
          return undefined
        },
      },
    },
  },
})
