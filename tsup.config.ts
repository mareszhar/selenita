import { defineConfig } from 'tsup'

// tsup's DTS plugin (rollup.js) sets `baseUrl: compilerOptions.baseUrl || "."`, which
// TypeScript 6 treats as deprecated. We use a build-specific tsconfig to acknowledge
// this tool-level workaround without polluting our development tsconfig.json.
const shared = {
  dts: true,
  splitting: false,
  treeshake: true,
  external: ['typescript', 'vitest'],
  tsconfig: './tsconfig.build.json',
} as const

export default defineConfig([
  {
    // Core — ships both ESM and CJS so consumers with any module system can require() it.
    ...shared,
    entry: { index: 'src/index.ts' },
    format: ['esm', 'cjs'],
    clean: true,
    esbuildOptions(options) {
      options.conditions = ['import', 'require']
    },
  },
  {
    // Vitest addon — ESM-only. Vitest itself is ESM-first and expect.extend() is a
    // side-effect import; there is no meaningful CJS path to expose here.
    ...shared,
    entry: { vitest: 'src/vitest.ts' },
    format: ['esm'],
    esbuildOptions(options) {
      options.conditions = ['import']
    },
  },
])
