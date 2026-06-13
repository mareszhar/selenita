import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * Packs a tarball of the current build, installs it in a temp project, and
 * verifies that all exports-map entries (`@mszr/selenita`, `/vitest`)
 * type-check cleanly from a real package-resolution perspective.
 *
 * Run after `bun run build`. Requires `dist/` to exist.
 */
const repoRootDir = resolve(fileURLToPath(import.meta.url), '..', '..')
const repoNodeModulesDir = join(repoRootDir, 'node_modules')
const tscBinPath = join(repoNodeModulesDir, '.bin', 'tsc')

interface PackEntry {
  filename: string
}

function runCommand(command: string, args: string[], cwd = repoRootDir): string {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  }
  catch (error) {
    if (typeof error === 'object' && error !== null) {
      const stderr = 'stderr' in error && typeof error.stderr === 'string' ? error.stderr.trim() : ''
      const stdout = 'stdout' in error && typeof error.stdout === 'string' ? error.stdout.trim() : ''
      const message = 'message' in error && typeof error.message === 'string' ? error.message : String(error)
      throw new Error(`Command failed: ${command} ${args.join(' ')}\n${stderr || stdout || message}`)
    }

    throw error
  }
}

function parsePackEntries(packOutput: string): PackEntry[] {
  const parsed = JSON.parse(packOutput) as unknown

  if (!Array.isArray(parsed))
    throw new Error('Unexpected `npm pack --json` output: expected an array.')

  const entries = parsed.filter((entry): entry is PackEntry => {
    return typeof entry === 'object'
      && entry !== null
      && 'filename' in entry
      && typeof entry.filename === 'string'
  })

  if (entries.length === 0)
    throw new Error('Unexpected `npm pack --json` output: no tarball filename found.')

  return entries
}

function writeJsonFile(filePath: string, value: unknown): void {
  writeFileSync(filePath, JSON.stringify(value, null, 2))
}

function writeTextFile(filePath: string, value: string): void {
  writeFileSync(filePath, value)
}

function ensurePeerSymlink(projectNodeModulesDir: string, packageName: string): void {
  const sourcePath = join(repoNodeModulesDir, packageName)
  if (!existsSync(sourcePath))
    return

  const destinationPath = join(projectNodeModulesDir, packageName)
  const parentDir = join(destinationPath, '..')

  if (!existsSync(parentDir))
    mkdirSync(parentDir, { recursive: true })

  if (!existsSync(destinationPath))
    symlinkSync(sourcePath, destinationPath)
}

let tempProjectDir: string | undefined
let tarballPath: string | undefined

try {
  console.log('[smoke] Packing tarball...')
  const packEntries = parsePackEntries(runCommand('npm', ['pack', '--json', '--cache', '.npm-cache']))
  const firstPackEntry = packEntries[0]
  if (!firstPackEntry)
    throw new Error('Unexpected `npm pack --json` output: no tarball filename found.')
  tarballPath = join(repoRootDir, firstPackEntry.filename)

  tempProjectDir = mkdtempSync(join(tmpdir(), 'selenita-smoke-'))
  writeJsonFile(join(tempProjectDir, 'package.json'), {
    name: 'selenita-smoke',
    version: '1.0.0',
    private: true,
    type: 'module',
  })

  console.log('[smoke] Installing tarball...')
  runCommand('bun', ['add', tarballPath], tempProjectDir)

  const tempNodeModulesDir = join(tempProjectDir, 'node_modules')

  // dist/*.d.ts files reference these peer modules directly.
  ensurePeerSymlink(tempNodeModulesDir, 'typescript')
  ensurePeerSymlink(tempNodeModulesDir, 'vitest')
  ensurePeerSymlink(tempNodeModulesDir, '@vitest')

  writeJsonFile(join(tempProjectDir, 'tsconfig.json'), {
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
  })

  writeTextFile(join(tempProjectDir, 'check.ts'), `\
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

  console.log('[smoke] Running tsc (ESM/Bundler) against installed package...')
  runCommand(tscBinPath, ['--noEmit', '-p', 'tsconfig.json'], tempProjectDir)

  writeJsonFile(join(tempProjectDir, 'tsconfig.vitest-types.json'), {
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
  })

  writeTextFile(join(tempProjectDir, 'check-vitest-types.ts'), `\
expect(['x']).toContainCompletion('x')
expect(['x']).toEqualCompletions(['x'])
export {}
`)

  console.log('[smoke] Running tsc (compilerOptions.types fallback) against installed package...')
  runCommand(tscBinPath, ['--noEmit', '-p', 'tsconfig.vitest-types.json'], tempProjectDir)

  writeJsonFile(join(tempProjectDir, 'tsconfig.cjs.json'), {
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
  })

  writeTextFile(join(tempProjectDir, 'check.cts'), `\
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

  console.log('[smoke] Running tsc (CJS/NodeNext) against installed package...')
  runCommand(tscBinPath, ['--noEmit', '-p', 'tsconfig.cjs.json'], tempProjectDir)

  writeTextFile(join(tempProjectDir, 'runtime-esm.mjs'), `\
import { cursor, defineProject, group, snippet } from '@mszr/selenita'
import '@mszr/selenita/vitest'
void cursor, defineProject, group, snippet
`)
  console.log('[smoke] Running runtime ESM import check...')
  runCommand('node', ['runtime-esm.mjs'], tempProjectDir)

  writeTextFile(join(tempProjectDir, 'runtime-cjs.cjs'), `\
const { cursor, defineProject, group, snippet } = require('@mszr/selenita')
void cursor, defineProject, group, snippet
`)
  console.log('[smoke] Running runtime CJS require check...')
  runCommand('node', ['runtime-cjs.cjs'], tempProjectDir)

  console.log('[smoke] OK — all export entries resolve from a real tarball install')
}
catch (error) {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\n[smoke] FAILED: ${message}`)
  process.exit(1)
}
finally {
  if (tarballPath)
    rmSync(tarballPath, { force: true })
  if (tempProjectDir)
    rmSync(tempProjectDir, { recursive: true, force: true })
  rmSync(join(repoRootDir, '.npm-cache'), { recursive: true, force: true })
}
