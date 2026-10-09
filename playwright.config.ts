import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { defineConfig } from '@playwright/test'

// Le serveur Vite passe en HTTPS seulement si certs/ est present (cf. vite.config.ts).
const https = existsSync(resolve(process.cwd(), 'certs/key.pem')) && existsSync(resolve(process.cwd(), 'certs/cert.pem'))

export default defineConfig({
  testDir: './e2e',
  timeout: 30000,
  use: {
    baseURL: `${https ? 'https' : 'http'}://localhost:4173`,
    ignoreHTTPSErrors: true,
  },
  webServer: {
    command: 'npm run preview',
    port: 4173,
    reuseExistingServer: true,
    timeout: 60000,
  },
})
