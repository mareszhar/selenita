// @ts-check
/**
 * Packs a tarball of the current build, installs it in a temp project, and
 * verifies that all exports-map entries (@mszr/selenita, /vitest)
 * type-check cleanly from a real package-resolution perspective.
 *
 * Run after `bun run build`. Requires dist/ to exist.
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..')
const ROOT_MODULES = join(ROOT, 'node_modules')
const TSC = join(ROOT_MODULES, '.bin', 'tsc')

/**
 * @param {string} cmd
 * @param {string} [cwd]
 */
function run(cmd, cwd = ROOT) {
  try {
    return execSync(cmd, { cwd, stdio: 'pipe' }).toString().trim()
  }
  catch (error) {
    const err = /** @type {any} */ (error)
    const msg = err.stderr?.toString().trim() || err.stdout?.toString().trim() || err.message
    throw new Error(`Command failed: ${cmd}\n${msg}`)
  }
}

let tmpDir = null
let tarballPath = null

try {
  // 1. Pack the tarball (--cache avoids permission failures with /Users/*/.npm in locked-down envs)
  console.log('[smoke] Packing tarball...')
  const packData = JSON.parse(run('npm pack --json --cache .npm-cache'))
  tarballPath = join(ROOT, packData[0].filename)

  // 2. Set up temp consumer project
  tmpDir = mkdtempSync(join(tmpdir(), 'selenita-smoke-'))
  writeFileSync(join(tmpDir, 'package.json'), JSON.stringify({
    name: 'selenita-smoke',
    version: '1.0.0',
    private: true,
    type: 'module',
  }))

  // 3. Install the tarball (bun uses a content-addressed global cache — fast on repeat runs)
  console.log('[smoke] Installing tarball...')
  run(`bun add ${tarballPath}`, tmpDir)

  // 4. Symlink peer-dep packages from root node_modules so our dist/*.d.ts files
  //    can resolve their module-augmentation targets. Only the packages directly
  //    referenced in dist/*.d.ts need to be present; transitive imports inside
  //    those packages' own .d.ts files are suppressed by skipLibCheck.
  const nm = join(tmpDir, 'node_modules')

  /** @param {string} name */
  function symlink(name) {
    const src = join(ROOT_MODULES, name)
    if (!existsSync(src))
      return
    const dst = join(nm, name)
    const parent = join(dst, '..')
    if (!existsSync(parent))
      mkdirSync(parent, { recursive: true })
    if (!existsSync(dst))
      symlinkSync(src, dst)
  }

  symlink('typescript') // index.d.ts: `import * as ts from 'typescript'`
  symlink('vitest') //    vitest.d.ts: `declare module 'vitest'`
  symlink('@vitest') //   vitest scope dir (transitive resolution inside vitest/index.d.ts)

  // 5. Write tsconfig for ESM/Bundler consumer
  writeFileSync(join(tmpDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022'],
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    include: ['check.ts'],
  }, null, 2))

  // 6. Minimal ESM/Bundler consumer — exercises all exports-map entries
  writeFileSync(join(tmpDir, 'check.ts'), `\
import { cursor, defineProject, group, snippet } from '@mszr/selenita'
import { expect } from 'vitest'
import '@mszr/selenita/vitest'

declare const _project: ReturnType<typeof defineProject>

const _q = _project.query\`const x = \${cursor}\`
const _completions: string[] = _q.completions
const _hover: string | null = _q.hover
const _g = group('apis', ['a', 'b'])
const _s = snippet\`\${cursor}\`
expect(_completions).toContainCompletion('x')
void _q, _completions, _hover, _g, _s
export {}
`)

  // 7. Type-check ESM/Bundler consumer
  console.log('[smoke] Running tsc (ESM/Bundler) against installed package...')
  run(`${TSC} --noEmit -p tsconfig.json`, tmpDir)

  // 8. Type-only setup fallback — users whose Vitest setup file is outside
  //    tsconfig.include can load the matcher augmentation through compilerOptions.types.
  writeFileSync(join(tmpDir, 'tsconfig.vitest-types.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022'],
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      types: ['vitest/globals', '@mszr/selenita/vitest'],
    },
    include: ['check-vitest-types.ts'],
  }, null, 2))

  writeFileSync(join(tmpDir, 'check-vitest-types.ts'), `\
expect(['x']).toContainCompletion('x')
expect(['x']).toEqualCompletions(['x'])
export {}
`)

  console.log('[smoke] Running tsc (compilerOptions.types fallback) against installed package...')
  run(`${TSC} --noEmit -p tsconfig.vitest-types.json`, tmpDir)

  // 9. Write tsconfig for CJS/NodeNext consumer
  writeFileSync(join(tmpDir, 'tsconfig.cjs.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      lib: ['ES2022'],
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
    },
    include: ['check.cts'],
  }, null, 2))

  // 10. Minimal CJS consumer — verifies the require() export path resolves correctly
  writeFileSync(join(tmpDir, 'check.cts'), `\
import selenita = require('@mszr/selenita')
const { cursor, defineProject, group, snippet } = selenita
declare const _project: ReturnType<typeof defineProject>

const _q = _project.query\`const x = \${cursor}\`
const _completions: string[] = _q.completions
const _g = group('apis', ['a', 'b'])
const _s = snippet\`\${cursor}\`
void _q, _completions, _g, _s
export {}
`)

  // 11. Type-check CJS/NodeNext consumer
  console.log('[smoke] Running tsc (CJS/NodeNext) against installed package...')
  run(`${TSC} --noEmit -p tsconfig.cjs.json`, tmpDir)

  // 12. Runtime ESM import check — actually load both advertised ESM entries
  //     (tsc --noEmit only type-checks; it does not execute the module loader)
  writeFileSync(join(tmpDir, 'runtime-esm.mjs'), `\
import { cursor, defineProject, group, snippet } from '@mszr/selenita'
import '@mszr/selenita/vitest'
void cursor, defineProject, group, snippet
`)
  console.log('[smoke] Running runtime ESM import check...')
  run('node runtime-esm.mjs', tmpDir)

  // 13. Runtime CJS require check — actually load the CJS index entry
  writeFileSync(join(tmpDir, 'runtime-cjs.cjs'), `\
const { cursor, defineProject, group, snippet } = require('@mszr/selenita')
void cursor, defineProject, group, snippet
`)
  console.log('[smoke] Running runtime CJS require check...')
  run('node runtime-cjs.cjs', tmpDir)

  console.log('[smoke] OK — all export entries resolve from a real tarball install')
}
catch (error) {
  const err = /** @type {any} */ (error)
  console.error(`\n[smoke] FAILED: ${err.message}`)
  process.exit(1)
}
finally {
  if (tarballPath)
    rmSync(tarballPath, { force: true })
  if (tmpDir)
    rmSync(tmpDir, { recursive: true, force: true })
  rmSync(join(ROOT, '.npm-cache'), { recursive: true, force: true })
}
