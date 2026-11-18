import { execSync } from 'node:child_process'
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

// Version affichee dans l'interface (commit du build).
function gitVersion(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(gitVersion()),
    __APP_BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt' : jamais de rechargement automatique (il couperait un programme en cours).
      registerType: 'prompt',
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
        globPatterns: ['**/*.{js,css,html,svg,woff,woff2}'],
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
  // Worker FAO en module ES (il charge les polices a la demande : code-splitting).
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2021',
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/three')) return 'three'
          if (id.includes('node_modules/react') || id.includes('node_modules/scheduler')) return 'react'
          if (id.includes('opentype')) return 'fonts'
          if (id.includes('clipper-lib')) return 'clipper'
          return undefined
        },
      },
    },
  },
})
