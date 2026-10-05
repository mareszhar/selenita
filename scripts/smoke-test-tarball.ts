import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// A real install gate: no workspace symlinks, peer guessing, or skipped declarations.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = mkdtempSync(join(tmpdir(), 'selenita-package-'))
function runCommand(command: string, args: string[], cwd = root): string {
  try {
    return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  }
  catch (cause) {
    const failure = cause as { stdout?: string, stderr?: string }
    throw new Error(`${command} ${args.join(' ')} failed\n${failure.stdout ?? ''}\n${failure.stderr ?? ''}`, { cause })
  }
}
function createJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`)
}
const runtimeSource = `
const { createProject, cursor, snippet } = selenita
const project = createProject({ tsconfig: false })
try {
  const result = project.query\`\${snippet.join(['const fruit = { apple: 1 };', snippet\`fruit.\${cursor}\`], '\\n')}\`
  if (!result.completionNames.includes('apple')) throw new Error('missing native completion')
  const version = result.inspect(({ typescript }) => typescript.version)
  if (!version.startsWith('6.')) throw new Error('unexpected backend: ' + version)
  console.log('Node ' + process.version + ': core ' + entry + ', bundled TypeScript ' + version)
} finally { project.dispose() }
`
const testSource = `
import type { Plugin } from '@mszr/selenita/vitest'
import { createProject, cursor as coreCursor, snippet as coreSnippet } from '@mszr/selenita'
import { cursor, defineProject, mark, snippet } from '@mszr/selenita/vitest'
import { expect, it } from 'vitest'
const plugin: Plugin = () => ({ create(info) {
  if (info.config.label !== 'installed') throw new Error('missing plugin config')
  return info.languageService
} })
const project = defineProject({ tsconfig: false, plugins: [[plugin, { label: 'installed' }]] })
it('uses the installed entries, plugins, records and every matcher', async () => {
  expect(coreCursor).toBe(cursor)
  expect(coreSnippet).toBe(snippet)
  const fragment = snippet\`fruit.\${coreCursor('member')}\`
  const result = project.query({
    'fruit.ts': 'export const fruit = { apple: 1, pear: 2 }',
    'use.ts': snippet\`import { fruit } from './fruit'; \${snippet.join([fragment.scope('first'), fragment.scope('second')], ';\\n')}\`,
  })
  expect(result.at('first.member')).toSuggest('apple')
  expect(result.at('first.member')).not.toSuggest(['private', 'internal'])
  expect(result.at('first.member')).toSuggestOnly(['apple', 'pear'])
  expect(result.atEach('member', ['first', 'second'])).toHaveCompletionParity()
  const clean = project.check({ 'clean.ts': 'export const fruit = 1' })
  expect(clean).toBeClean()
  expect(clean).toHaveErrorCount(0)
  const report = project.check\`const \${mark('type')\`fruit\`}: number = 'apple'\`
  expect(report).toHaveError(2322, /string/, { on: report.rangeOf('type') })
  expect(report).toHaveErrorCount(1)
  await expect(Promise.resolve(['apple'])).resolves.toSuggest('apple')
  expect(['apple']).toEqual(expect.not.toSuggest(['pear', 'private']))
  using owner = createProject({ tsconfig: false })
  const backend = owner.check\`const fruit = 1\`.inspect(({ typescript }) => typescript.version)
  expect(backend).toMatch(/^6\\./)
  console.log('installed observations use bundled TypeScript ' + backend)
})
`
try {
  const packed = JSON.parse(runCommand('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', workspace])) as Array<{ filename: string }>
  const tarball = join(workspace, packed[0]!.filename)
  for (const compilerVersion of ['6.0.3', '7.0.2']) {
    const consumer = mkdtempSync(join(workspace, `typescript-${compilerVersion}-`))
    console.log(`[package] Fresh TypeScript ${compilerVersion}, Vitest 5.0.3 consumer`)
    createJson(join(consumer, 'package.json'), {
      name: 'selenita-package-consumer',
      private: true,
      type: 'module',
      dependencies: { '@mszr/selenita': `file:${tarball}`, 'typescript': compilerVersion, 'vitest': '5.0.3', '@types/node': '25.9.1', 'typescript-plugin-css-modules': '5.2.0' },
    })
    runCommand('bun', ['install', '--ignore-scripts'], consumer)
    for (const file of ['main.types.ts', 'vitest.types.ts'])
      writeFileSync(join(consumer, file), readFileSync(join(root, 'tests/consumer', file)))
    createJson(join(consumer, 'tsconfig.json'), {
      compilerOptions: { target: 'ES2022', lib: ['ES2022'], module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, skipLibCheck: false, types: ['node'] },
      include: ['*.ts'],
    })
    writeFileSync(join(consumer, 'package.test.ts'), testSource)
    writeFileSync(join(consumer, 'vitest.config.ts'), 'export default { test: { globals: false } }\n')
    writeFileSync(join(consumer, 'button.module.css'), '.button { color: red }\n.card { color: blue }\n')
    writeFileSync(join(consumer, 'environment.d.ts'), 'export {}\n')
    createJson(join(consumer, 'tsconfig.plugin.json'), {
      compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, skipLibCheck: false, types: [] },
      files: ['environment.d.ts'],
    })
    writeFileSync(join(consumer, 'plugin.test.ts'), readFileSync(join(root, 'tests/consumer/package.plugin.ts'), 'utf8').replaceAll('defineProject()', 'defineProject({ tsconfig: \'./tsconfig.plugin.json\' })').replace('defineProject({ plugins:', 'defineProject({ tsconfig: \'./tsconfig.plugin.json\', plugins:'))
    writeFileSync(join(consumer, 'navigation.test.ts'), readFileSync(join(root, 'tests/consumer/package.navigation.ts')))
    console.log(runCommand('node', [join(consumer, 'node_modules/typescript/bin/tsc'), '--version'], consumer))
    runCommand('node', [join(consumer, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'], consumer)
    console.log(runCommand('node', [join(consumer, 'node_modules/vitest/vitest.mjs'), 'run'], consumer))
    writeFileSync(join(consumer, 'runtime-esm.mjs'), `import * as selenita from '@mszr/selenita'; const entry = 'ESM';\n${runtimeSource}`)
    writeFileSync(join(consumer, 'runtime-cjs.cjs'), `const selenita = require('@mszr/selenita'); const entry = 'require';\n${runtimeSource}`)
    for (const nodeVersion of ['22.12.0', '24.21.0']) {
      for (const file of ['runtime-esm.mjs', 'runtime-cjs.cjs'])
        console.log(runCommand('npm', ['exec', '--yes', `--package=node@${nodeVersion}`, '--', 'node', file], consumer))
    }
    const manifest = JSON.parse(readFileSync(join(consumer, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }
    if (compilerVersion.startsWith('7') && ('@typescript/typescript6' in manifest.dependencies || manifest.dependencies.typescript !== '7.0.2'))
      throw new Error('TypeScript 7 consumer must not supply its own TypeScript 6')
  }
  console.log('[package] Both strict installed lanes passed; observations use bundled TypeScript 6')
}
finally {
  rmSync(workspace, { recursive: true, force: true })
}
