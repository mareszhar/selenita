import type { Plugin, ProjectConfig, QueryResult } from '../src/types'
import { mkdtempSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createProject, cursor, mark, SelenitaError, snippet } from '../src/index'
import ts from '../src/typescript'
import { defineProject } from '../src/vitest'

function collectDisplayText<Cursors extends string, Marks extends string>(result: QueryResult<Cursors, Marks>, name: Cursors | Marks): string {
  return result.inspect(({ service, resolvePath, typescript }) => {
    const range = result.rangeOf(name)
    return typescript.displayPartsToString(service.getQuickInfoAtPosition(resolvePath(range.file), range.start.offset)?.displayParts)
  })
}
function collectErrorCodes(result: Pick<QueryResult, 'files' | 'inspect'>): number[] {
  return result.inspect(({ service, resolvePath }) => Object.keys(result.files).flatMap(file => service.getSemanticDiagnostics(resolvePath(file)).map(diagnostic => diagnostic.code)))
}
const managedProject = defineProject({ tsconfig: false })

describe('project ownership', () => {
  it('works without runner globals and supports using', () => {
    using project = createProject({ tsconfig: false })
    expect(collectDisplayText(project.query`const ${mark('fruit')`fruit`} = 1`, 'fruit')).toContain('fruit')
    expect(managedProject.query`${cursor}1`.files).toEqual({ '__selenita__.ts': '1' })
  })
  it('creates plugins lazily and warms up synchronously', () => {
    let creationCount = 0
    const plugin: Plugin = () => ({ create(info) {
      creationCount++
      return info.languageService
    } })
    using project = createProject({ tsconfig: false, plugins: [plugin] })
    project.query`${cursor}1`
    expect(creationCount).toBe(0)
    project.warmUp()
    project.warmUp()
    expect(creationCount).toBe(1)
  })
  it('disposes descendants once and permits early child disposal', () => {
    let disposalCount = 0
    const plugin: Plugin = () => ({ create(info) {
      const dispose = info.languageService.dispose.bind(info.languageService)
      return { ...info.languageService, dispose() {
        disposalCount++
        dispose()
      } }
    } })
    const project = createProject({ tsconfig: false, plugins: [plugin] })
    const child = project.extend()
    const grandchild = child.extend()
    for (const member of [project, child, grandchild]) member.warmUp()
    child.dispose()
    expect(disposalCount).toBe(2)
    project.warmUp()
    project.dispose()
    project.dispose()
    expect(disposalCount).toBe(3)
    for (const member of [project, child, grandchild]) {
      expect(() => member.query`${cursor}`).toThrow(/disposed[\s\S]*hint:/)
      expect(() => member.extend()).toThrow(SelenitaError)
    }
  })
  it('rejects declaring a runner-owned project inside a test', () => {
    expect(() => defineProject({ tsconfig: false })).toThrow(/hint:.*createProject.*extend/)
    using project = managedProject.extend({ compilerOptions: { exactOptionalPropertyTypes: true } })
    expect(project.query`${cursor}1`.files).toBeDefined()
  })
})

describe('configuration layers', () => {
  it.each([
    [{ module: 'esnext', moduleResolution: 'nodenext' }, { module: 'nodenext' }, { module: 'esnext' }, 5110],
    [{ strictNullChecks: false, exactOptionalPropertyTypes: true }, { strictNullChecks: true }, { strictNullChecks: false }, 5052],
    [{ allowImportingTsExtensions: true }, { noEmit: true }, { noEmit: false }, 5096],
  ] as const)('rejects incompatible effective compiler options %j', (invalid, repair, brokenOverride, code) => {
    const nativeOptions = ts.convertCompilerOptionsFromJson({ strict: true, target: 'es2022', module: 'esnext', moduleResolution: 'bundler', ...invalid }, process.cwd()).options
    expect(ts.createProgram([], nativeOptions).getOptionsDiagnostics().map(diagnostic => diagnostic.code)).toContain(code)
    expect(() => createProject({ tsconfig: false, compilerOptions: invalid })).toThrow(new RegExp(`effective compilerOptions[\\s\\S]*TS${code}[\\s\\S]*hint:`))
    using project = createProject({ tsconfig: false, compilerOptions: invalid }, { compilerOptions: repair })
    const result = project.check`const fruit = 1`
    expect(result).toBeClean()
    expect(result.inspect(({ service }) => service.getProgram()!.getOptionsDiagnostics())).toEqual([])
    expect(() => project.extend({ compilerOptions: brokenOverride })).toThrow(/effective compilerOptions/)
    expect(project.check`const fruit = 2`).toBeClean()
  })
  it('validates inherited overrides without treating fixture emit layout as an editor error', () => {
    const directory = mkdtempSync(join(tmpdir(), 'selenita-effective-config-'))
    const base = join(directory, 'base.json')
    const path = join(directory, 'tsconfig.json')
    writeFileSync(base, JSON.stringify({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' } }))
    writeFileSync(path, JSON.stringify({ extends: './base.json', include: [] }))
    expect(() => createProject({ tsconfig: path, compilerOptions: { module: 'esnext' } })).toThrow(/TS5110/)
    using project = createProject({ tsconfig: path, compilerOptions: { module: 'esnext', moduleResolution: 'bundler', rootDir: './src', noEmit: true } })
    project.warmUp()
    const consumer = project.query`const fruit = { apple: 1 }; fruit.${cursor}apple`
    expect(consumer).toSuggestOnly(['apple'])
    expect(consumer).toBeClean()
    // The anonymous fixture is intentionally outside the source emit directory.
    expect(consumer.inspect(({ service }) => service.getProgram()!.getOptionsDiagnostics().map(diagnostic => diagnostic.code))).toContain(6059)
    const source = project.check({ 'src/inside.ts': 'export const fruit = 1' })
    expect(source).toBeClean()
    expect(source.inspect(({ service }) => service.getProgram()!.getOptionsDiagnostics())).toEqual([])
  })
  it('rejects preference typos and invalid values in every layer', () => {
    const typo = { includeCompletionsWithInsertTex: false, quotePreference: 'single' } as const
    expect(() => createProject({ tsconfig: false, preferences: typo })).toThrow(/unknown preference 'includeCompletionsWithInsertTex'[\s\S]*hint:/)
    for (const preferences of [
      { includeCompletionsWithInsertText: 'false' },
      { quotePreference: 'mixed' },
      { autoImportFileExcludePatterns: [42] },
      { maximumHoverLength: -1 },
    ]) {
      expect(() => createProject({ tsconfig: false, preferences: preferences as NonNullable<ProjectConfig['preferences']> }, { preferences: { includeCompletionsWithInsertText: false } })).toThrow(/invalid preference '[\s\S]*hint:/)
    }
    using project = createProject({ tsconfig: false, preferences: { includeCompletionsWithInsertText: false, quotePreference: 'single', autoImportFileExcludePatterns: ['**/internal/**'], maximumHoverLength: 500 } })
    expect(project.query`const fruit = { 'red-apple': 1, kiwi: 2 }; fruit.${cursor}`).toSuggestOnly(['kiwi'])
    using child = project.extend({ preferences: { includeCompletionsWithInsertText: true } })
    expect(child.query`const fruit = { 'red-apple': 1, kiwi: 2 }; fruit.${cursor}`).toSuggestOnly(['red-apple', 'kiwi'])
    expect(() => project.extend({ preferences: typo })).toThrow(/unknown preference/)
  })
  it.each([
    [{ mystery: 1 }, /unknown.*mystery.*|valid keys/],
    [{ tsconfig: '/not-a-real-tsconfig.json' }, /tsconfig.*not-a-real/],
    [{ compilerOptions: { target: 'not-a-target' } }, /target/],
    [{ files: { 'a.ts': 42 } }, /files/],
    [{ aliases: { pkg: 42 } }, /aliases/],
    [{ plugins: [42] }, /plugin/],
  ])('rejects invalid configuration %j immediately', (config, message) => {
    expect(() => createProject(config as ProjectConfig)).toThrow(message)
    using project = createProject({ tsconfig: false })
    expect(project).toBeDefined()
  })
  it('merges map keys and plugin order without mutating the base', () => {
    const order: string[] = []
    const first: Plugin = () => ({ create(info) {
      order.push('first')
      return info.languageService
    } })
    const second: Plugin = () => ({ create(info) {
      order.push(String(info.config.label))
      return info.languageService
    } })
    using project = createProject({ tsconfig: false, files: { 'a.ts': 'export const a = 1' }, aliases: { a: './a.ts' }, compilerOptions: { strict: true }, preferences: { includeCompletionsForModuleExports: true }, plugins: [first] }, { files: { 'b.ts': 'export const b = 2' }, aliases: { b: './b.ts' }, compilerOptions: { exactOptionalPropertyTypes: true }, plugins: [[second, { label: 'second' }]] })
    expect(collectErrorCodes(project.query`import { a } from 'a'; import { b } from 'b'; ${cursor}void [a,b]`)).toEqual([])
    project.warmUp()
    expect(order).toEqual(['first', 'second'])
    using child = project.extend({ files: { 'a.ts': 'export const a = "child"' } })
    expect(collectDisplayText(child.query`import { a } from 'a'; ${mark('use')`a`}`, 'use')).toContain('"child"')
    expect(collectDisplayText(project.query`import { a } from 'a'; ${mark('use')`a`}`, 'use')).toContain('1')
  })
  it('honors the last tsconfig and lets aliases override paths', () => {
    const directory = mkdtempSync(join(tmpdir(), 'selenita-config-'))
    const firstConfig = join(directory, 'first.json')
    const secondConfig = join(directory, 'second.json')
    writeFileSync(firstConfig, JSON.stringify({ compilerOptions: { strict: false }, include: [] }))
    writeFileSync(secondConfig, JSON.stringify({ compilerOptions: { strict: true, moduleResolution: 'bundler', module: 'esnext', paths: { fruit: ['./missing.ts'] } }, include: [] }))
    using parent = createProject({ tsconfig: firstConfig })
    using child = parent.extend({ tsconfig: secondConfig, files: { 'fruit.ts': 'export const fruit = 1' }, aliases: { fruit: './fruit.ts' } })
    const options = child.query`${cursor}`.inspect(({ service }) => service.getProgram()!.getCompilerOptions())
    expect(options.strict).toBe(true)
    expect(collectErrorCodes(child.query`import { fruit } from 'fruit'; ${cursor}void fruit`)).toEqual([])
  })
  it('validates every layer even when a later one overrides it', () => {
    expect(() => createProject({ tsconfig: '/missing-layer.json' }, { tsconfig: false })).toThrow(/tsconfig.*missing-layer/)
    using project = createProject({ tsconfig: false }, { tsconfig: false })
    expect(project).toBeDefined()
  })
  it('accepts a tsconfig without inputs but rejects other parse errors', () => {
    const directory = mkdtempSync(join(tmpdir(), 'selenita-config-'))
    const path = join(directory, 'tsconfig.json')
    writeFileSync(path, JSON.stringify({ compilerOptions: { strict: true }, include: ['no-such-files/**/*'] }))
    using project = createProject({ tsconfig: path })
    expect(project.query`${cursor}1`.files).toBeDefined()
    writeFileSync(path, JSON.stringify({ compilerOptions: { target: 'bad' } }))
    expect(() => createProject({ tsconfig: path })).toThrow(/target/)
  })
})

describe('plugin hosting', () => {
  it('passes the documented host members and composes service decoration', () => {
    const plugin: Plugin = ({ typescript }) => ({ create(info) {
      expect(typescript.version).toBe(ts.version)
      expect(info.project.getCurrentDirectory()).toEqual(expect.any(String))
      expect(info.project.getCompilerOptions()).toBe(info.languageServiceHost.getCompilationSettings())
      expect(info.project.getProjectName()).toEqual(expect.any(String))
      info.project.projectService.logger.info('ignored')
      const service = info.languageService
      return { ...service, getSuggestionDiagnostics(file) {
        return [...service.getSuggestionDiagnostics(file), { category: typescript.DiagnosticCategory.Suggestion, code: 9999, messageText: info.config.message, file: service.getProgram()!.getSourceFile(file)!, start: 0, length: 1 }]
      } }
    } })
    using project = createProject({ tsconfig: false, plugins: [[plugin, { message: 'plugin suggestion' }]] })
    const diagnostics = project.query`${cursor}1`.inspect(({ service, resolvePath }) => service.getSuggestionDiagnostics(resolvePath('__selenita__.ts')))
    expect(diagnostics).toContainEqual(expect.objectContaining({ code: 9999, messageText: 'plugin suggestion' }))
  })
  it('names unsupported tsserver members instead of returning undefined', () => {
    const plugin: Plugin = () => ({ create(info) {
      info.serverHost.readFile('a')
      return info.languageService
    } })
    using project = createProject({ tsconfig: false, plugins: [plugin] })
    expect(() => project.warmUp()).toThrow(/serverHost[\s\S]*hint:/)
  })
  it('keeps a plugin creation failure as the original cause', () => {
    const cause = new Error('plugin failed')
    using project = createProject({ tsconfig: false, plugins: [() => ({ create() {
      throw cause
    } })] })
    try {
      project.warmUp()
      expect.unreachable()
    }
    catch (error) {
      expect(error).toBeInstanceOf(SelenitaError)
      expect((error as Error).cause).toBe(cause)
    }
  })
})

describe('native host behavior', () => {
  it('keeps real sources stable until a new project reads the rebuilt files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'selenita-disk-lifetime-'))
    const path = join(directory, 'tsconfig.json')
    const source = join(directory, 'fruit.ts')
    writeFileSync(path, JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler' }, files: ['fruit.ts'] }))
    writeFileSync(source, 'export const fruit = { apple: 1 }')
    using project = createProject({ tsconfig: path })
    expect(project.query`import { fruit } from './fruit'; fruit.${cursor}`).toSuggestOnly(['apple'])
    writeFileSync(source, 'export const fruit = { kiwi: 1 }')
    expect(project.query`import { fruit } from './fruit'; fruit.${cursor}`).toSuggestOnly(['apple'])
    using rebuilt = createProject({ tsconfig: path })
    expect(rebuilt.query`import { fruit } from './fruit'; fruit.${cursor}`).toSuggestOnly(['kiwi'])
    const overlay = project.query({ 'fruit.ts': 'export const fruit = { pear: 1 }', 'use.ts': snippet`import { fruit } from './fruit'; fruit.${cursor('member')}` })
    expect(overlay.at('member')).toSuggestOnly(['pear'])
    expect(project.query`import { fruit } from './fruit'; fruit.${cursor}`).toSuggestOnly(['apple'])
  })
  it('observes fixture and lifetime files with Windows path separators', () => {
    using project = createProject({ tsconfig: false, files: { 'fruit\\basket.ts': 'export const fruit = { apple: 1 }' } })
    const result = project.query({ 'fruit\\consumer.ts': snippet`import { fruit } from './basket'; fruit.${cursor('member')}apple` })
    expect(result.completionNames).toEqual(['apple'])
    expect(result.errors).toEqual([])
    expect(result.rangeOf('member').file).toBe('fruit/consumer.ts')
    const overlay = project.query({
      'fruit\\basket.ts': 'export const fruit = { kiwi: 1 }',
      'fruit\\consumer.ts': snippet`import { fruit } from './basket'; fruit.${cursor('member')}kiwi`,
    })
    expect(overlay.completionNames).toEqual(['kiwi'])
    expect(overlay.errors).toEqual([])
    expect(result.findCompletion('apple')?.displayText).toBe('(property) apple: number')
  })

  it('respects package exports and each import mode exactly as TypeScript does', () => {
    const files = {
      'node_modules/fruit/package.json': JSON.stringify({ name: 'fruit', exports: { '.': { import: './import.d.mts', require: './require.d.cts' } } }),
      'node_modules/fruit/import.d.mts': 'export declare const branch: "import"',
      'node_modules/fruit/require.d.cts': 'export declare const branch: "require"',
      'node_modules/fruit/hidden.d.ts': 'export declare const secret: 1',
    }
    using project = createProject({ tsconfig: false, files, compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' } })
    for (const [extension, mode] of [['mts', ts.ModuleKind.ESNext], ['cts', ts.ModuleKind.CommonJS]] as const) {
      const result = project.query({ [`consumer.${extension}`]: snippet`import { branch } from 'fruit'; ${mark('use')`branch`}` })
      const nativeResolution = result.inspect(({ service, resolvePath }) => ts.resolveModuleName('fruit', resolvePath(`consumer.${extension}`), service.getProgram()!.getCompilerOptions(), { fileExists: path => path in Object.fromEntries(Object.keys(files).map(key => [resolve(key), true])) || ts.sys.fileExists(path), readFile: path => files[path.slice(resolve('.').length + 1) as keyof typeof files] ?? ts.sys.readFile(path), directoryExists: () => true }, undefined, undefined, mode).resolvedModule)
      expect(nativeResolution?.resolvedFileName).toContain(extension === 'mts' ? 'import.d.mts' : 'require.d.cts')
      expect(collectDisplayText(result, 'use')).toContain(extension === 'mts' ? '"import"' : '"require"')
      expect(collectErrorCodes(result)).toEqual([])
    }
    expect(collectErrorCodes(project.query`import { secret } from 'fruit/hidden'; ${cursor}void secret`)).toContain(2307)
  })
  it('resolves real packages and real siblings from root-relative records', () => {
    using project = createProject({ files: {}, compilerOptions: { types: ['node'], allowImportingTsExtensions: true, noEmit: true } })
    const result = project.query({ 'tests/fixtures/consumer.ts': snippet`import { registerFruit } from './fruit'; import { join } from 'node:path'; ${cursor}void [registerFruit,join]` })
    expect(collectErrorCodes(result)).toEqual([])
  })
  it('activates records with JSX context and restores a real-file overlay', () => {
    const directory = mkdtempSync(join(tmpdir(), 'selenita-overlay-'))
    const config = join(directory, 'tsconfig.json')
    writeFileSync(config, JSON.stringify({ compilerOptions: { jsx: 'preserve', strict: true }, files: ['real.ts'] }))
    writeFileSync(join(directory, 'real.ts'), 'export const fruit = "disk"')
    using project = createProject({ tsconfig: config, files: { 'jsx.d.ts': 'declare namespace JSX { interface IntrinsicElements { fruit: { sweet?: boolean } } }' } })
    const overlay = project.query({ 'real.ts': 'export const fruit = "overlay"', 'consumer.tsx': snippet`import { fruit } from './real'; ${mark('use')`fruit`}; <fruit ${cursor('props')}/>` })
    expect(collectDisplayText(overlay, 'use')).toContain('"overlay"')
    const nativeNames = overlay.inspect(({ service, resolvePath }) => service.getCompletionsAtPosition(resolvePath('consumer.tsx'), overlay.rangeOf('props').start.offset, {})?.entries.map(entry => entry.name))
    expect(nativeNames).toContain('sweet')
    const original = project.query`import { fruit } from './real'; ${mark('use')`fruit`}`
    expect(collectDisplayText(original, 'use')).toContain('"disk"')
    expect(collectDisplayText(overlay, 'use')).toContain('"overlay"')
  })
  it('isolates different project contents at the same fixture path', () => {
    using first = createProject({ tsconfig: false })
    using second = createProject({ tsconfig: false })
    const apple = first.query`const fruit = 'apple' as const; ${mark('use')`fruit`}`
    const kiwi = second.query`const fruit = 'kiwi' as const; ${mark('use')`fruit`}`
    expect(collectDisplayText(apple, 'use')).toContain('"apple"')
    expect(collectDisplayText(kiwi, 'use')).toContain('"kiwi"')
    expect(collectDisplayText(apple, 'use')).toContain('"apple"')
  })
  it('sees changed real contents even when their modification time is preserved', () => {
    const directory = mkdtempSync(join(tmpdir(), 'selenita-registry-'))
    const config = join(directory, 'tsconfig.json')
    const realFile = join(directory, 'real.ts')
    writeFileSync(config, JSON.stringify({ compilerOptions: { strict: true }, files: ['real.ts'] }))
    writeFileSync(realFile, 'export const fruit = "apple" as const')
    const metadata = statSync(realFile)
    using first = createProject({ tsconfig: config })
    expect(collectDisplayText(first.query`import { fruit } from './real'; ${mark('use')`fruit`}`, 'use')).toContain('"apple"')
    writeFileSync(realFile, 'export const fruit = "kiwi" as const')
    utimesSync(realFile, metadata.atime, metadata.mtime)
    using second = createProject({ tsconfig: config })
    expect(collectDisplayText(second.query`import { fruit } from './real'; ${mark('use')`fruit`}`, 'use')).toContain('"kiwi"')
  })
})
