import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    // beforeAll builds the TS Program eagerly (spec §15). Large projects can
    // take >5 s on a cold run; 30 s gives ample headroom without masking hangs.
    hookTimeout: 30000,
    typecheck: {
      enabled: false,
    },
  },
})
