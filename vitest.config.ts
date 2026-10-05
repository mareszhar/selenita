import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: false,
    include: ['tests/**/*.test.ts'],
    exclude: [
      'dist/**',
      'node_modules/**',
      '__archived__/**',
      '__references__/**',
      '__temp__/**',
    ],
    // defineProject warms the TS Program in beforeAll. Large projects can
    // take >5 s on a cold run; 30 s gives ample headroom without masking hangs.
    hookTimeout: 30000,
    typecheck: {
      enabled: false,
    },
  },
})
