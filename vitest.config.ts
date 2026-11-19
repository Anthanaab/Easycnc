import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('test'),
    __APP_BUILD_DATE__: JSON.stringify('1970-01-01T00:00:00.000Z'),
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    // fetch() des fichiers du projet (polices) servis depuis le disque.
    setupFiles: ['test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/__tests__/**', 'src/**/*.d.ts'],
      reporter: ['text-summary', 'text'],
      // Garde-fou contre les regressions (a relever quand la couverture progresse).
      thresholds: { lines: 58, functions: 72, branches: 72, statements: 58 },
    },
  },
})
