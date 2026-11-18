import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify('test'),
    __APP_BUILD_DATE__: JSON.stringify('1970-01-01T00:00:00.000Z'),
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
