import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { index: 'src/index.ts', vitest: 'src/vitest.ts' },
  format: 'esm',
  target: 'es2022',
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  dts: true,
  clean: true,
})
