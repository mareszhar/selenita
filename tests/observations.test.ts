import type { Plugin, QueryResult } from '../src/types'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createProject, cursor, mark, SelenitaError, snippet } from '../src/index'
import { applyEdits } from '../src/ranges'
import ts from '../src/typescript'

const requestNames = ['getCompletionsAtPosition', 'getCompletionEntryDetails', 'getQuickInfoAtPosition', 'getSignatureHelpItems', 'provideInlayHints', 'getRenameInfo', 'findRenameLocations', 'getSyntacticDiagnostics', 'getSemanticDiagnostics', 'getSuggestionDiagnostics', 'getCodeFixesAtPosition'] as const
type RequestName = typeof requestNames[number]
function createCountingPlugin(runRequestHook?: (name: RequestName, args: unknown[]) => void) {
  const requestCounts: Partial<Record<RequestName, number>> = {}
  const plugin: Plugin = () => ({ create(info) {
    const service = { ...info.languageService }
    const methods = service as unknown as Record<RequestName, (...args: unknown[]) => unknown>
    for (const name of requestNames) {
      const original = info.languageService[name] as (...args: unknown[]) => unknown
      methods[name] = (...args) => {
        requestCounts[name] = (requestCounts[name] ?? 0) + 1
        runRequestHook?.(name, args)
        return original.apply(info.languageService, args)
      }
    }
    return service
  } })
  return { plugin, requestCounts }
}
function createFruitQuery(project: ReturnType<typeof createProject>) {
  return project.query`const ${mark('definition')`fruitBasket`} = ['apple']; ${mark('typo')`fruitBaskt`}; const fruit = { apple: 1 }; fruit.${cursor('caret')}`
}

describe('lazy observation ownership', () => {
  it('pays only for a completion list and shares it with completion names', () => {
    const { plugin, requestCounts } = createCountingPlugin()
    using project = createProject({ tsconfig: false, plugins: [plugin] })
    const result = project.query`const fruit = { apple: 1, kiwi: 2 }; fruit.${cursor}`
    expect(requestCounts).toEqual({})
    expect(result.completionNames).toEqual(['apple', 'kiwi'])
    expect(result.completionNames).toBe(result.completionNames)
    expect(result.completions.filter(completion => completion.kind === 'property').map(completion => completion.name)).toEqual(['apple', 'kiwi'])
    expect(requestCounts).toEqual({ getCompletionsAtPosition: 1 })
    expect(result.findCompletion('apple')?.displayText).toBe('(property) apple: number')
    expect(result.findCompletion('apple')?.documentation).toBe('')
    expect(requestCounts.getCompletionEntryDetails).toBe(1)
    for (const completion of result.completions) void completion.documentation
    expect(requestCounts.getCompletionEntryDetails).toBe(2)
    expect(Object.isFrozen(result.completions)).toBe(true)
    expect(Object.isFrozen(result.completions[0])).toBe(true)
  })
  it('reuses syntactic and semantic diagnostics without evaluating suggestions or fixes', () => {
    const { plugin, requestCounts } = createCountingPlugin()
    using project = createProject({ tsconfig: false, plugins: [plugin] })
    const result = createFruitQuery(project)
    expect(result.errors.some(error => error.code === 2552)).toBe(true)
    expect(requestCounts).toEqual({ getSyntacticDiagnostics: 1, getSemanticDiagnostics: 1 })
    expect(Object.isFrozen(result.errors[0])).toBe(true)
    void result.diagnostics
    expect(requestCounts).toEqual({ getSyntacticDiagnostics: 1, getSemanticDiagnostics: 1, getSuggestionDiagnostics: 1 })
    expect(result.errors).toBe(result.errors)
  })
  it('keeps read values after disposal and names unread fields', () => {
    const project = createProject({ tsconfig: false })
    const result = project.query`const fruit = { apple: 1 }; fruit.${cursor}`
    const names = result.completionNames
    project.dispose()
    expect(result.completionNames).toBe(names)
    expect(() => result.hover).toThrow(/hover.*disposed[\s\S]*hint:/)
    expect(() => result.inspect(() => 1)).toThrow(/disposed/)
    expect(result.files['__selenita__.ts']).toContain('apple')
    const secondProject = createProject({ tsconfig: false })
    const unread = secondProject.query`const fruit = { kiwi: 1 }; fruit.${cursor}`
    secondProject.dispose()
    expect(() => unread.completionNames).toThrow(/completionNames.*disposed/)
  })
  it('reactivates old results with different file sets and overlays', () => {
    using project = createProject({ tsconfig: false, files: { 'stable.d.ts': 'declare const stable: 1' } })
    const apple = project.query({ 'fruit.ts': 'export const fruit = { apple: 1 }', 'consumer.ts': snippet`import { fruit } from './fruit'; fruit.${cursor('caret')}` })
    const kiwi = project.query({ 'fruit.ts': 'export const fruit = { kiwi: 1 }', 'extra.ts': 'export {}', 'consumer.ts': snippet`import { fruit } from './fruit'; fruit.${cursor('caret')}` })
    expect(kiwi.completionNames).toEqual(['kiwi'])
    expect(apple.completionNames).toEqual(['apple'])
    expect(apple.inspect(({ service }) => service.getProgram()!.getSourceFile(join(process.cwd(), 'extra.ts')))).toBeUndefined()
    expect(project.check`const value: 1 = stable`.errors).toEqual([])
  })
  it('keeps project globals while removing fixture globals and augmentations', () => {
    using project = createProject({ tsconfig: false, files: { 'base.d.ts': 'interface Basket { stable: 1 }; declare const basket: Basket' } })
    const extended = project.query`export {}; declare global { interface Basket { extra: 1 }; const fixtureOnly: 1 }; basket.${cursor}`
    expect(extended.completionNames).toEqual(['extra', 'stable'])
    const plain = project.query`basket.${cursor}; fixtureOnly`
    expect(plain.completionNames).toEqual(['stable'])
    expect(plain.errors.some(error => error.code === 2304)).toBe(true)
    expect(extended.hover).toBeNull()
    expect(project.check`const value: 1 = basket.stable`.errors).toEqual([])
  })
  it('recomputes package resolution when a fixture changes only package metadata', () => {
    using project = createProject({ tsconfig: false, files: { 'node_modules/fruits/apple.d.ts': 'export declare const fruit: { apple: 1 }', 'node_modules/fruits/kiwi.d.ts': 'export declare const fruit: { kiwi: 1 }' } })
    const consumer = snippet`import { fruit } from 'fruits'; fruit.${cursor('caret')}`
    const apple = project.query({ 'node_modules/fruits/package.json': JSON.stringify({ name: 'fruits', exports: { '.': { types: './apple.d.ts' } } }), 'consumer.ts': consumer })
    const kiwi = project.query({ 'node_modules/fruits/package.json': JSON.stringify({ name: 'fruits', exports: { '.': { types: './kiwi.d.ts' } } }), 'consumer.ts': consumer })
    expect(kiwi.completionNames).toEqual(['kiwi'])
    expect(apple.completionNames).toEqual(['apple'])
    expect(kiwi.findCompletion('kiwi')?.displayText).toContain('kiwi')
  })
  it('lets stateful plugins see the active fixture after a swap', () => {
    const seen = new Map<string, string>()
    const plugin: Plugin = () => ({ create(info) {
      const service = info.languageService
      return { ...service, getQuickInfoAtPosition(file, position) {
        const text = info.languageServiceHost.getScriptSnapshot(file)!
        seen.set(file, text.getText(0, text.getLength()))
        return service.getQuickInfoAtPosition(file, position)
      } }
    } })
    using project = createProject({ tsconfig: false, plugins: [plugin] })
    const apple = project.query`const ${mark('fruit')`fruit`} = 'apple' as const`
    const kiwi = project.query`const ${mark('fruit')`fruit`} = 'kiwi' as const`
    expect(kiwi.at('fruit').hover?.displayText).toContain('"kiwi"')
    expect(apple.at('fruit').hover?.displayText).toContain('"apple"')
    expect([...seen.values()][0]).toContain('\'apple\'')
  })
})

describe('located observations', () => {
  it('reports fixture diagnostics without replacing a whole-project typecheck', () => {
    using project = createProject({ tsconfig: false, files: { 'fruit.ts': 'export const fruit: number = "wrong"' } })
    const clean = project.check`import { fruit } from './fruit'; const value: number = fruit`
    expect(clean.errors).toEqual([])
    expect(clean.inspect(({ service, resolvePath }) => service.getSemanticDiagnostics(resolvePath('fruit.ts')).map(diagnostic => diagnostic.code))).toContain(2322)
    expect(project.check`import { fruit } from './fruit'; const value: string = fruit`.errors).toContainEqual(expect.objectContaining({ code: 2322, range: expect.objectContaining({ text: 'value' }) }))
  })
  it('fans out over scoped marks for hover and rename without adding a cursor', () => {
    using project = createProject({ tsconfig: false })
    const result = project.query({
      'fruit.ts': snippet`export const fruit = { ${snippet`${mark('symbol')`apple`}`.scope('definition')}: 1 }`,
      'use.ts': snippet`import { fruit } from './fruit'; void fruit.${snippet`${mark('symbol')`apple`}`.scope('use')}`,
    })
    const members = result.atEach('symbol', ['definition', 'use'])
    const expected = [result.rangeOf('definition.symbol'), result.rangeOf('use.symbol')]
    for (const observed of Object.values(members)) {
      expect(observed.hover?.displayText).toContain('apple: number')
      expect(observed.rename.canRename).toBe(true)
      expect(observed.rename.locations).toEqual(expected)
    }
    expect(() => result.atEach('symbol', ['missing'] as never)).toThrow(/missing.*no marker.*symbol[\s\S]*hint:/)
    expect(() => result.hover).toThrow(/exactly one cursor/)
    expect(Object.isFrozen(members)).toBe(true)
    expect(Object.keys(result.atEach('symbol'))).toEqual(['definition', 'use'])
  })
  it('joins complete examples on separate lines and keeps inline argument and string markers', () => {
    using project = createProject({ tsconfig: false })
    const queries = ['db.findMany', 'db.findOne', 'db.aggregate'] as const
    const calls = queries.map(api => snippet`${mark('call')`${api}({ where: { ${cursor('where')} } })`}`.scope(api))
    const result = project.query`
      declare const db: Record<'findMany' | 'findOne' | 'aggregate', (options: { where: { status?: string } }) => void>
      ${snippet.join(calls, '\n')}
    `
    expect(result.errors).toEqual([])
    for (const observed of Object.values(result.atEach('where', queries)))
      expect(observed.completionNames).toContain('status')
    expect(queries.map(api => result.rangeOf(`${api}.where`).start.line)).toEqual([3, 4, 5])
    expect(result.rangeOf('db.findMany.call').text).toBe('db.findMany({ where: {  } })')
    const args = [snippet`${cursor('first')}1`, snippet`${cursor('second')}2`] as const
    const inline = project.query({
      'call.ts': snippet`declare function sum(first: number, second: number): number; sum(${snippet.join(args, ', ')})`,
    })
    expect(inline.errors).toEqual([])
    expect(inline.at('second').signatureHelp?.activeParameterIndex).toBe(1)
    expect(inline.rangeOf('second')).toMatchObject({ file: 'call.ts', text: '', start: { line: 1 } })
    const segments = [mark('resource')`users`, mark('action')`list`] as const
    const route = project.check`const route = '${snippet.join(segments, '/')}'`
    expect(route.errors).toEqual([])
    expect(route.rangeOf('action')).toMatchObject({ text: 'list', start: { line: 1, offset: 21 }, end: { offset: 25 } })
    const union = project.check`type Fruit = ${snippet.join([mark('apple')`'apple'`, mark('pear')`'pear'`], ' | ')}`
    expect(union.errors).toEqual([])
    expect(union.rangeOf('pear').text).toBe('\'pear\'')
    expect(project.check`const value: number = (() => { return ${[cursor('return'), '42']} })()`.errors).toEqual([])
    expect(project.check`const route = '${segments}'`.errors).toEqual([])
  })
  it('guards root fields without exposing them during equality of multi-cursor results', () => {
    using project = createProject({ tsconfig: false })
    const result = project.query`const fruit = { apple: 1 }; fruit.${cursor('first')}; fruit.${cursor('second')}`
    expect(() => result.completionNames).toThrow(/first.*second[\s\S]*hint:.*at/)
    expect(Object.keys(result)).not.toContain('completionNames')
    expect(result).toEqual({ ...result })
    expect(result.at('first').completionNames).toEqual(['apple'])
    const marked = project.query`const ${mark('fruit')`fruit`} = 1`
    expect(() => marked.hover).toThrow(/hint:.*at/)
    expect(marked.at('fruit').hover?.range).toEqual(marked.rangeOf('fruit'))
    expect(() => result.at('unknown' as 'first')).toThrow(/available names:.*first.*second[\s\S]*hint:/)
    expect(() => project.query`${cursor}`.at('caret' as never)).toThrow(/bare cursor[\s\S]*hint:/)
  })
  it('gathers exactly the requested scopes and rejects lost members', () => {
    using project = createProject({ tsconfig: false })
    const result = project.query`${snippet`const fruit = { apple: 1 }; fruit.${cursor('member')}`.scope('db.findMany')}; ${snippet`fruit.${cursor('member')}`.scope('db.findOne')}`
    expect(Object.keys(result.atEach('member', ['db.findOne', 'db.findMany']))).toEqual(['db.findOne', 'db.findMany'])
    expect(Object.keys(result.atEach('member'))).toEqual(['db.findMany', 'db.findOne'])
    expect(() => result.atEach('member', ['absent' as 'db.findMany'])).toThrow(/absent.*member[\s\S]*hint:/)
    expect(() => result.atEach('missing' as 'member')).toThrow(/available.*member[\s\S]*hint:/)
    const numeric = project.query`const fruit = { apple: 1 }; ${['10', '2'].map(scope => snippet`fruit.${cursor('member')}apple;`.scope(scope))}`
    expect(Object.keys(numeric.atEach('member', ['10', '2']))).toEqual(['2', '10'])
    expect(numeric.at('10.member').completionNames).toEqual(['apple'])
  })
  it('renders hover shape, documentation, tags and whole text separately', () => {
    using project = createProject({ tsconfig: false })
    const result = project.query`/** Delicious fruit.\n * @example fruit\n */\nconst ${mark('fruit')`fruit`} = 1`
    const hover = result.at('fruit').hover
    expect(hover).toMatchObject({ displayText: 'const fruit: 1', documentation: 'Delicious fruit.', tags: [{ name: 'example', text: 'fruit' }], text: 'const fruit: 1\n\nDelicious fruit.\n\n@example fruit', range: result.rangeOf('fruit') })
    expect(Object.isFrozen(hover?.tags)).toBe(true)
  })
  it('honors the configured hover length with native truncation', () => {
    const fields = Array.from({ length: 20 }, (_, index) => `fruit${index}: string`).join('; ')
    const fixture = snippet`declare const ${mark('fruit')`fruit`}: { ${fields} }; void fruit`
    const displays = new Map<number, string>()
    for (const maximumHoverLength of [50, 500]) {
      using project = createProject({ tsconfig: false, preferences: { maximumHoverLength } })
      const observed = project.query`${fixture}`.at('fruit').hover?.displayText
      // Native displays are cached: use an independent program for each limit.
      using nativeProject = createProject({ tsconfig: false })
      const nativeResult = nativeProject.query`${fixture}`
      const native = nativeResult.inspect(({ service, typescript, resolvePath }) => typescript.displayPartsToString(service.getQuickInfoAtPosition(resolvePath('__selenita__.ts'), nativeResult.rangeOf('fruit').start.offset, maximumHoverLength)?.displayParts))
      expect(observed).toBe(native)
      expect(observed).toContain('fruit0: string')
      expect(observed).toContain('fruit19: string')
      displays.set(maximumHoverLength, observed!)
    }
    expect(displays.get(50)).toContain('... 15 more ...')
    expect(displays.get(500)).toContain('fruit10: string')
    expect(displays.get(500)).not.toContain('more ...')
  })
  it('reports UTF-16 positions across CRLF and preserves the diagnostic underline', () => {
    using project = createProject({ tsconfig: false })
    const result = project.check`// 😀\r\nconst value: number = ${mark('typo')`'wrong'`}`
    const range = result.rangeOf('typo')
    expect(range.start).toEqual({ line: 2, column: 23, offset: 29 })
    expect(range.end.offset - range.start.offset).toBe(7)
    expect(result.errors[0]?.range?.text).toBe('value')
    expect(result.errors[0]?.range?.file).toBe('__selenita__.ts')
  })
  it('keeps dot-prefixed fixture names relative and outside files absolute', () => {
    using project = createProject({ tsconfig: false })
    const result = project.check({
      '..fruit.ts': snippet`export const ${mark('inside')`fruit`} = 1`,
      '../fruit.ts': snippet`export const ${mark('outside')`fruit`} = 2`,
    })
    expect(result.rangeOf('inside').file).toBe('..fruit.ts')
    expect(result.rangeOf('outside').file).toBe(resolve('../fruit.ts').replace(/\\/gu, '/'))
    expect(result.errors).toEqual([])
  })
  it('maps related information and positionless diagnostics without losing message chains', () => {
    const plugin: Plugin = ({ typescript }) => ({ create(info) {
      const service = info.languageService
      return { ...service, getSemanticDiagnostics(file) {
        const source = service.getProgram()!.getSourceFile(file)!
        return [...service.getSemanticDiagnostics(file), { category: typescript.DiagnosticCategory.Error, code: 9000, messageText: { category: typescript.DiagnosticCategory.Error, code: 9000, messageText: 'Outer', next: [{ category: typescript.DiagnosticCategory.Error, code: 9001, messageText: 'Inner' }] }, file: undefined, start: undefined, length: undefined, relatedInformation: [{ category: typescript.DiagnosticCategory.Message, code: 9002, messageText: 'Related', file: source, start: 0, length: 1 }] }]
      } }
    } })
    using project = createProject({ tsconfig: false, plugins: [plugin] })
    expect(project.check`1`.errors[0]).toMatchObject({ code: 9000, range: null, message: 'Outer\n  Inner', relatedInformation: [{ message: 'Related', range: { text: '1' } }] })
  })
  it('keeps genuine absence empty', () => {
    using project = createProject({ tsconfig: false })
    const result = project.query`// comment ${cursor}`
    expect(result.completionNames).toEqual([])
    expect(result.hover).toBeNull()
    expect(result.signatureHelp).toBeNull()
    expect(result.rename.canRename).toBe(false)
    expect(result.rename.reason).toEqual(expect.any(String))
  })
  it('guides arguments, overloads and rest parameters with objects and indices', () => {
    using project = createProject({ tsconfig: false })
    const result = project.query`declare function pack(label: string, count: number): void; declare function pack(label: number, count: number): void; pack('x', ${cursor})`
    expect(result.signatureHelp).toMatchObject({ activeSignatureIndex: 0, activeParameterIndex: 1, activeParameter: { name: 'count' } })
    expect(result.signatureHelp?.signatures).toHaveLength(2)
    expect(result.signatureHelp?.activeSignature).toBe(result.signatureHelp?.signatures[0])
    const rest = project.query`declare function log(level: string, ...parts: number[]): void; log('x', 1, 2, ${cursor})`
    expect(rest.signatureHelp).toMatchObject({ activeParameterIndex: 1, activeParameter: { name: 'parts' } })
    expect(project.query`declare function empty(): void; empty(${cursor})`.signatureHelp?.activeParameter).toBeNull()
  })
  it('locates all hint kinds across files and honors preference overrides', () => {
    using project = createProject({ tsconfig: false })
    const result = project.query`declare function pack(count: number): string; const label${cursor('type')} = pack(${cursor('count')}3)`
    expect(result.inlayHints).toContainEqual({ text: ': string', kind: 'type', range: result.rangeOf('type') })
    expect(result.inlayHints).toContainEqual({ text: 'count:', kind: 'parameter', range: result.rangeOf('count') })
    using quiet = project.extend({ preferences: { includeInlayParameterNameHints: 'none' } })
    expect(quiet.check`declare function pack(count: number): string; const label = pack(3)`.inlayHints.map(hint => hint.text)).not.toContain('count:')
    const files = project.check({ 'b.ts': 'declare function pack(): string; export const value = pack()', 'a.ts': 'declare function pack(): string; export const value = pack()' })
    expect(files.inlayHints.map(hint => hint.range.file)).toEqual(['a.ts', 'b.ts'])
  })
  it('renames identity across files, includes project uses, and excludes unrelated keys', () => {
    using project = createProject({ tsconfig: false, files: { 'project.ts': 'import { colors } from \'./colors\'; void colors.brand' } })
    const result = project.query({ 'colors.ts': snippet`export const colors = { ${mark('definition')`brand`}: 1 }`, 'consumer.ts': snippet`import { colors } from './colors'; void colors.${mark('use')`brand`}`, 'other.ts': 'export const other = { brand: 1 }' })
    const locations = result.at('use').rename.locations
    expect(locations.slice(0, 2)).toEqual([result.rangeOf('definition'), result.rangeOf('use')])
    expect(locations[2]?.file).toBe('project.ts')
    expect(result.at('definition').rename.locations).toEqual(locations)
    const shorthand = project.query`const ${mark('definition')`fruit`} = 1; const basket = { fruit }; void basket`
    expect(shorthand.at('definition').rename.locations.some(location => location.prefixText || location.suffixText)).toBe(true)
    expect(project.query`${cursor}true`.rename.canRename).toBe(false)
  })
  it('binds synchronous inspection to the requested fixture and rejects thenables', () => {
    using project = createProject({ tsconfig: false })
    const first = project.query`const ${mark('definition')`fruit`} = 'apple' as const; ${mark('use')`fruit`}`
    const second = project.query`const ${mark('definition')`fruit`} = 'kiwi' as const; ${mark('use')`fruit`}`
    expect(second.at('use').hover?.displayText).toContain('"kiwi"')
    const definition = first.inspect(({ service, resolvePath }) => service.getDefinitionAtPosition(resolvePath('__selenita__.ts'), first.rangeOf('use').start.offset))
    expect(definition?.[0]?.textSpan.start).toBe(first.rangeOf('definition').start.offset)
    expect(() => first.inspect(async () => 1)).toThrow(/thenable[\s\S]*hint:.*synchronously/)
  })
})

describe('completion insertion and details', () => {
  it('exposes bracket insertion and optional-chain suggestions by default', () => {
    using project = createProject({ tsconfig: false })
    const result = project.query`const fruit = { 'red-apple': 1, kiwi: 2 }; fruit.${cursor}`
    expect(result.findCompletion('red-apple')).toMatchObject({ insertText: '["red-apple"]', replacementRange: { text: '.' }, kind: 'property', isDeprecated: false, isOptional: false })
    expect(project.query`declare const maybe: { a: 1 } | undefined; maybe.${cursor}`.findCompletion('a')?.insertText).toBe('?.a')
    using plain = project.extend({ preferences: { includeCompletionsWithInsertText: false } })
    expect(plain.query`const fruit = { 'red-apple': 1, kiwi: 2 }; fruit.${cursor}`.completionNames).toEqual(['kiwi'])
    expect(project.query`declare function pick(fruit: 'apple' | 'kiwi'): void; pick('${cursor}')`.completionNames).toEqual(['apple', 'kiwi'])
  })
  it('keeps native kind and flags and selects plugin duplicates by source', () => {
    const data = { token: 'entry-data' }
    const plugin: Plugin = ({ typescript }) => ({ create(info) {
      const service = info.languageService
      return { ...service, getCompletionsAtPosition(file, offset, options) {
        const list = service.getCompletionsAtPosition(file, offset, options)!
        return { ...list, entries: ['one', 'two'].map(source => ({ name: 'fruit', kind: typescript.ScriptElementKind.constElement, kindModifiers: 'deprecated,optional', isRecommended: true, sortText: '1', source, data: data as unknown as ts.CompletionEntryData })) }
      }, getCompletionEntryDetails(file, offset, name, format, source, preferences, entryData) {
        expect(entryData).toBe(data)
        expect(preferences?.includeCompletionsWithInsertText).toBe(true)
        return { name, kind: typescript.ScriptElementKind.constElement, kindModifiers: '', displayParts: [{ text: source!, kind: 'text' }], documentation: [{ text: 'Documented', kind: 'text' }] }
      } }
    } })
    using project = createProject({ tsconfig: false, plugins: [plugin] })
    const result = project.query`const fruit = { apple: 1 }; fruit.${cursor}`
    expect(result.completionNames).toEqual(['fruit', 'fruit'])
    expect(result.findCompletion({ name: 'fruit', source: 'two' })).toMatchObject({ kind: 'const', isDeprecated: true, isOptional: true, isRecommended: true })
    expect(result.findCompletion({ name: 'fruit', source: 'two' })?.displayText).toBe('two')
    expect(result.findCompletion('missing')).toBeUndefined()
  })
  it('resolves a real package auto-import with its source and edit', () => {
    const directory = mkdtempSync(join(tmpdir(), 'selenita-auto-import-'))
    mkdirSync(join(directory, 'node_modules/fruit-kit'), { recursive: true })
    writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'esnext', moduleResolution: 'bundler' }, include: [] }))
    writeFileSync(join(directory, 'node_modules/fruit-kit/package.json'), JSON.stringify({ name: 'fruit-kit', exports: { '.': { types: './index.d.ts' } } }))
    writeFileSync(join(directory, 'node_modules/fruit-kit/index.d.ts'), 'export interface Fruit { sweet: boolean }; /** Pick fruit. */ export declare function pickFruit(): Fruit')
    const config = { tsconfig: join(directory, 'tsconfig.json'), preferences: { includeCompletionsForModuleExports: true } }
    using unloaded = createProject(config)
    const unknown = unloaded.query`export {}; pickFru${cursor('auto')}`
    expect(unknown.findCompletion({ name: 'pickFruit', source: 'fruit-kit' })).toBeUndefined()
    expect(unknown.inspect(({ service, resolvePath }) => service.getCompletionsAtPosition(resolvePath('__selenita__.ts'), unknown.rangeOf('auto').start.offset, config.preferences)?.entries.some(entry => entry.name === 'pickFruit'))).toBe(false)
    using project = createProject(config, { files: { 'auto-import-seed.ts': 'import type { Fruit } from \'fruit-kit\'' } })
    const result = project.query`export {}; pickFru${cursor('auto')}`
    const completion = result.findCompletion({ name: 'pickFruit', source: 'fruit-kit' })
    expect(completion?.kind).toBe('function')
    expect(completion?.codeActions.flatMap(action => action.edits).some(edit => edit.newText.includes('pickFruit'))).toBe(true)
    expect(completion?.displayText).toBe('function pickFruit(): Fruit')
    expect(result.files['__selenita__.ts']).not.toContain('import')
    const acceptance = project.query`export {}; pickFruit${cursor}()`
    expect(acceptance.errors.map(error => error.code)).toContain(2304)
    const action = acceptance.findCompletion({ name: 'pickFruit', source: 'fruit-kit' })!.codeActions[0]!
    expect(project.check(action.fixedFiles).errors).toEqual([])
    expect(Object.isFrozen(action.fixedFiles)).toBe(true)

    expect(result.inspect(({ service, resolvePath }) => service.getCompletionsAtPosition(resolvePath('__selenita__.ts'), result.rangeOf('auto').start.offset, config.preferences)?.entries.some(entry => entry.name === 'pickFruit'))).toBe(true)
  })
})

describe('diagnostic fixes', () => {
  it('offers a native spelling fix whose transformed files recheck cleanly', () => {
    using project = createProject({ tsconfig: false })
    const result = project.check`const fruitBasket = ['apple']; fruitBaskt.push('kiwi')`
    const typo = result.errors.find(error => error.code === 2552)
    const fix = typo?.codeFixes.find(fix => fix.description.startsWith('Change spelling'))
    expect(fix?.edits[0]?.newText).toBe('fruitBasket')
    expect(project.check(fix!.fixedFiles).errors).toEqual([])
    expect(Object.isFrozen(fix?.fixedFiles)).toBe(true)
  })
  it('applies edits from the end, creates files, and rejects actual overlap', () => {
    const files = { 'a.ts': 'one two' }
    const createEditRange = (start: number, end: number) => ({ file: 'a.ts', start: { line: 1, column: start + 1, offset: start }, end: { line: 1, column: end + 1, offset: end }, text: files['a.ts'].slice(start, end) })
    expect(applyEdits(files, [{ range: createEditRange(0, 3), newText: '1' }, { range: createEditRange(4, 7), newText: '2' }])).toEqual({ 'a.ts': '1 2' })
    expect(applyEdits({}, [{ range: { ...createEditRange(0, 0), file: 'new.ts' }, newText: 'export {}' }])).toEqual({ 'new.ts': 'export {}' })
    expect(() => applyEdits(files, [{ range: createEditRange(0, 5), newText: '' }, { range: createEditRange(4, 7), newText: '' }])).toThrow(/overlap[\s\S]*hint:/)
  })
  it('keeps text edits readable when an editor command prevents fixedFiles', () => {
    const plugin: Plugin = () => ({ create(info) {
      return { ...info.languageService, getCodeFixesAtPosition(file) {
        return [{ fixName: 'command', description: 'Needs a command', changes: [{ fileName: file, textChanges: [{ span: { start: 0, length: 0 }, newText: '// edit\n' }] }], commands: [{ type: 'install package', file, packageName: 'fruit' }] }]
      } }
    } })
    using project = createProject({ tsconfig: false, plugins: [plugin] })
    const fix = project.check`unknown`.errors[0]!.codeFixes[0]!
    expect(fix.edits[0]?.newText).toBe('// edit\n')
    expect(() => fix.fixedFiles).toThrow(/install package[\s\S]*hint:/)
  })
})

const failureReaders: Record<RequestName, (result: QueryResult<'caret', 'typo' | 'definition'>) => unknown> = {
  getCompletionsAtPosition: result => result.completionNames,
  getCompletionEntryDetails: result => result.findCompletion('apple')!.documentation,
  getQuickInfoAtPosition: result => result.hover,
  getSignatureHelpItems: result => result.signatureHelp,
  provideInlayHints: result => result.inlayHints,
  getRenameInfo: result => result.at('definition').rename,
  findRenameLocations: result => result.at('definition').rename,
  getSyntacticDiagnostics: result => result.errors,
  getSemanticDiagnostics: result => result.errors,
  getSuggestionDiagnostics: result => result.diagnostics,
  getCodeFixesAtPosition: result => result.errors.find(error => error.code === 2552)!.codeFixes,
}
it.each(requestNames)('reports %s failure with context and permits the next request', (request) => {
  const cause = new Error(`broken ${request}`)
  let shouldFail = true
  const { plugin } = createCountingPlugin((name) => {
    if (name === request && shouldFail) {
      shouldFail = false
      throw cause
    }
  })
  using project = createProject({ tsconfig: false, plugins: [plugin] })
  const result = createFruitQuery(project)
  try {
    failureReaders[request](result)
    expect.unreachable()
  }
  catch (error) {
    expect(error).toBeInstanceOf(SelenitaError)
    expect((error as Error).cause).toBe(cause)
    expect((error as Error).message).toContain(request)
    expect((error as Error).message).toContain(`TypeScript ${ts.version}`)
    expect((error as Error).message).toContain('__selenita__.ts:')
    expect((error as Error).message).toMatch(/│/)
  }
  const recovered = createFruitQuery(project)
  expect(() => failureReaders[request](recovered)).not.toThrow()
  expect(recovered.completionNames).toEqual(['apple'])
})

it.each(['getSyntacticDiagnostics', 'getSemanticDiagnostics', 'getSuggestionDiagnostics', 'provideInlayHints'] as const)('locates a %s failure in the file that was requested', (request) => {
  const cause = new Error('second file failed')
  let shouldFail = true
  const { plugin } = createCountingPlugin((name, args) => {
    if (name === request && shouldFail && String(args[0]).endsWith('/b.ts')) {
      shouldFail = false
      throw cause
    }
  })
  using project = createProject({ tsconfig: false, plugins: [plugin] })
  const files = { 'a.ts': 'export const apple = 1', 'b.ts': 'export const kiwi = 2' }
  const result = project.check(files)
  try {
    void (request === 'provideInlayHints' ? result.inlayHints : result.diagnostics)
    expect.unreachable()
  }
  catch (error) {
    expect((error as Error).cause).toBe(cause)
    expect((error as Error).message).toContain('b.ts:1:1')
    expect((error as Error).message).toContain('│ export const kiwi = 2')
    expect((error as Error).message).not.toContain('a.ts:1:1')
  }
  const recovered = project.check(files)
  expect(() => request === 'provideInlayHints' ? recovered.inlayHints : recovered.diagnostics).not.toThrow()
  expect(recovered.errors).toEqual([])
})

it('locates a code-fix failure in the diagnostic file and permits a retry', () => {
  const cause = new Error('second file fix failed')
  let shouldFail = true
  const { plugin } = createCountingPlugin((name) => {
    if (name === 'getCodeFixesAtPosition' && shouldFail) {
      shouldFail = false
      throw cause
    }
  })
  using project = createProject({ tsconfig: false, plugins: [plugin] })
  const result = project.check({ 'a.ts': 'export const apple = 1', 'b.ts': 'export const kiwi = 2; kiw' })
  const diagnostic = result.errors.find(error => error.code === 2552)!
  try {
    void diagnostic.codeFixes
    expect.unreachable()
  }
  catch (error) {
    expect((error as Error).cause).toBe(cause)
    expect((error as Error).message).toContain('b.ts:1:1')
    expect((error as Error).message).toContain('│ export const kiwi = 2; kiw')
  }
  const fix = diagnostic.codeFixes.find(fix => fix.description.startsWith('Change spelling'))!
  expect(project.check(fix.fixedFiles).errors).toEqual([])
})

it('observes JSX properties through the public completion view', () => {
  using project = createProject({ tsconfig: false, compilerOptions: { jsx: 'preserve' }, files: { 'jsx.d.ts': 'declare namespace JSX { interface IntrinsicElements { fruit: { sweet?: boolean } } }' } })
  const result = project.query({ 'consumer.tsx': snippet`const element = <fruit ${cursor('props')}/>` })
  expect(result.at('props').completionNames).toEqual(['sweet'])
  expect(result.findCompletion('sweet')?.isOptional).toBe(true)
  expect(result.errors).toEqual([])
})
it('orders diagnostics by kind, then file and position and excludes non-errors', () => {
  const plugin: Plugin = ({ typescript }) => ({ create(info) {
    const service = info.languageService
    return { ...service, getSuggestionDiagnostics(file) {
      return [...service.getSuggestionDiagnostics(file), { category: typescript.DiagnosticCategory.Message, code: 9001, messageText: 'A message', file: service.getProgram()!.getSourceFile(file)!, start: 0, length: 0 }]
    } }
  } })
  using project = createProject({ tsconfig: false, plugins: [plugin] })
  const result = project.check({ 'b.ts': 'export {}; const value: number = \'bad\'; unknownB', 'a.ts': 'export {}; const value: number = \'bad\'; unknownA' })
  expect(result.errors.map(error => [error.code, error.range?.file, error.range?.text])).toEqual([[2322, 'a.ts', 'value'], [2304, 'a.ts', 'unknownA'], [2322, 'b.ts', 'value'], [2304, 'b.ts', 'unknownB']])
  expect(result.diagnostics.slice(0, 4)).toEqual(result.errors)
  expect(result.diagnostics.filter(diagnostic => diagnostic.code === 9001).map(diagnostic => diagnostic.severity)).toEqual(['message', 'message'])
  expect(result.errors.every(diagnostic => diagnostic.severity === 'error')).toBe(true)
})
it('does not evaluate unread nested fields after the project is disposed', () => {
  const project = createProject({ tsconfig: false })
  const result = createFruitQuery(project)
  const completion = result.findCompletion('apple')!
  const errors = result.errors
  project.dispose()
  expect(completion.name).toBe('apple')
  expect(result.errors).toBe(errors)
  expect(() => completion.documentation).toThrow(/completion.documentation.*disposed/)
  expect(() => errors.find(error => error.code === 2552)!.codeFixes).toThrow(/codeFixes.*disposed/)
})

it('forwards layered editor preferences to every preference-aware request', () => {
  const preferenceIndices: Partial<Record<RequestName, number>> = { getCompletionsAtPosition: 2, getCompletionEntryDetails: 5, provideInlayHints: 2, getRenameInfo: 2, findRenameLocations: 4, getCodeFixesAtPosition: 5 }
  const forwarded: RequestName[] = []
  const { plugin } = createCountingPlugin((request, args) => {
    const index = preferenceIndices[request]
    if (index !== undefined) {
      expect(args[index]).toMatchObject({ quotePreference: 'single', includeCompletionsWithInsertText: true })
      forwarded.push(request)
    }
  })
  using project = createProject({ tsconfig: false, plugins: [plugin], preferences: { quotePreference: 'single' } })
  const result = createFruitQuery(project)
  void result.findCompletion('apple')?.displayText
  void result.inlayHints
  void result.at('definition').rename
  void result.errors.find(error => error.code === 2552)?.codeFixes
  expect(new Set(forwarded)).toEqual(new Set(Object.keys(preferenceIndices)))
})

it('keeps the compact guide display in the native literal spelling', () => {
  using project = createProject({ tsconfig: false })
  const { hover } = project.query`type TokenHandle<Kind> = { kind: Kind }; declare const handle: TokenHandle<'color'>; void ${cursor}handle`
  expect(hover?.displayText).toMatchInlineSnapshot(`"const handle: TokenHandle<\"color\">"`)
})

it('resolves the guide re-export relative to the virtual module directory', () => {
  using project = createProject({ tsconfig: false, files: { 'src/system.ts': 'export const ds = { color: "red" }', '.kit/system.ts': `export { ds } from '../src/system'` }, aliases: { '#kit/system': './.kit/system.ts' } })
  const result = project.query`import { ds } from '#kit/system'; ds.${cursor}`
  expect(result.completionNames).toEqual(['color'])
  expect(project.check`import { ds } from '#kit/system'; const color: string = ds.color`.errors).toEqual([])
})

it('applies completion actions across fixture and project files, and keeps command edits readable', () => {
  for (const needsCommand of [false, true]) {
    const plugin: Plugin = () => ({ create(info) {
      return { ...info.languageService, getCompletionEntryDetails(file, position, name) {
        return {
          name,
          kind: ts.ScriptElementKind.memberVariableElement,
          kindModifiers: '',
          displayParts: [],
          documentation: [],
          codeActions: [{
            description: 'Update fruit files',
            changes: [
              { fileName: file, textChanges: [{ span: { start: 0, length: 0 }, newText: '// accepted\n' }] },
              { fileName: resolve('other.ts'), textChanges: [{ span: { start: 0, length: 3 }, newText: 'two' }] },
              { fileName: resolve('project.ts'), textChanges: [{ span: { start: 0, length: 3 }, newText: 'new' }] },
            ],
            ...(needsCommand ? { commands: [{ type: 'install package', file, packageName: 'fruit' }] } : {}),
          }],
        }
      } }
    } })
    using project = createProject({ tsconfig: false, files: { 'project.ts': 'old source' }, plugins: [plugin] })
    const result = project.query({ 'use.ts': snippet`const fruit = { apple: 1 }; fruit.${cursor}`, 'other.ts': 'one source' })
    const action = result.findCompletion('apple')!.codeActions[0]!
    expect(action.edits.map(edit => edit.newText)).toEqual(['// accepted\n', 'two', 'new'])
    if (needsCommand) {
      expect(() => action.fixedFiles).toThrow(/install package[\s\S]*hint:/)
      expect(action.edits).toHaveLength(3)
    }
    else {
      expect(action.fixedFiles).toEqual({ 'use.ts': '// accepted\nconst fruit = { apple: 1 }; fruit.', 'other.ts': 'two source', 'project.ts': 'new source' })
      expect(Object.isFrozen(action)).toBe(true)
      expect(Object.isFrozen(action.fixedFiles)).toBe(true)
    }
  }
})

const callbackDefinitions = `
interface Tools { unit: (n: number) => string }
type FieldInput<V> = V | ((tools: Tools) => V)
declare function add<const G extends Record<string, unknown>>(fields: { [K in keyof G]: FieldInput<G[K]> }): G;
`
it('answers unfinished and complete callbacks independently of read order', () => {
  for (const complete of [false, true]) {
    for (const first of ['completions', 'errors', 'hover'] as const) {
      using project = createProject({ tsconfig: false })
      const result = project.query`${callbackDefinitions}add({ md: tools => tools.${cursor}${complete ? 'unit(1)' : ''} })`
      void result[first]
      expect(result.completionNames).toEqual(complete ? ['unit'] : [])
      expect(result.errors.map(error => error.code)).toEqual(complete ? [] : [1003])
    }
  }
})

it('gives each observation a program and rejoins lazy follow-ups with their parent', () => {
  const requests: { name: string, program: unknown }[] = []
  const plugin: Plugin = () => ({ create(info) {
    const service = { ...info.languageService }
    for (const name of requestNames) {
      const original = info.languageService[name] as (...args: unknown[]) => unknown
      ;(service as unknown as Record<string, (...args: unknown[]) => unknown>)[name] = (...args) => {
        requests.push({ name, program: info.languageService.getProgram() })
        return original.apply(info.languageService, args)
      }
    }
    return service
  } })
  using project = createProject({ tsconfig: false, plugins: [plugin] })
  const result = project.query`const fruit = { apple: 1, pear: 2 }; fruit.${cursor}apple; missingFruit`
  expect(result.completionNames).toEqual(['apple', 'pear'])
  expect(result.findCompletion('apple')?.displayText).toBe('(property) apple: number')
  expect(requests.map(request => request.name)).toEqual(['getCompletionsAtPosition', 'getCompletionEntryDetails'])
  expect(requests[0]!.program).toBeDefined()
  expect(requests[1]!.program).toBe(requests[0]!.program)
  const firstProgram = requests[0]!.program
  expect(result.hover?.displayText).toContain('apple: number')
  expect(requests[2]!.program).not.toBe(firstProgram)
  // A detail not yet read must replay the list on a fresh checker after hover.
  expect(result.findCompletion('pear')?.displayText).toContain('pear: number')
  expect(requests.slice(3).map(request => request.name)).toEqual(['getCompletionsAtPosition', 'getCompletionEntryDetails'])
  expect(requests[3]!.program).not.toBe(firstProgram)
  expect(requests[4]!.program).toBe(requests[3]!.program)
  const count = requests.length
  void result.completions
  void result.findCompletion('pear')!.documentation
  expect(requests).toHaveLength(count)
  const errors = result.errors
  expect(errors.map(error => error.code)).toContain(2304)
  const diagnostics = requests.slice(count)
  expect(diagnostics.map(request => request.name)).toEqual(['getSyntacticDiagnostics', 'getSemanticDiagnostics'])
  expect(diagnostics[0]!.program).toBe(diagnostics[1]!.program)
  const inspected = result.inspect(({ service }) => service.getProgram())
  expect(inspected).not.toBe(diagnostics[0]!.program)
  expect(result.inspect(({ service }) => service.getProgram())).not.toBe(inspected)
  void errors.find(error => error.code === 2304)!.codeFixes
  expect(requests.slice(count + 2).map(request => request.name)).toEqual(['getSyntacticDiagnostics', 'getSemanticDiagnostics', 'getCodeFixesAtPosition'])
  const followups = requests.slice(-3)
  expect(followups[0]!.program).not.toBe(inspected)
  expect(followups.every(request => request.program === followups[0]!.program)).toBe(true)
})

it('answers every scoped completion member on its own program', () => {
  const programs: unknown[] = []
  const plugin: Plugin = () => ({ create(info) {
    return { ...info.languageService, getCompletionsAtPosition(...args) {
      programs.push(info.languageService.getProgram())
      return info.languageService.getCompletionsAtPosition(...args)
    } }
  } })
  using project = createProject({ tsconfig: false, plugins: [plugin] })
  const result = project.query`const fruit = { apple: 1 }; ${snippet.join(['first', 'second'].map(scope => snippet`fruit.${cursor('member')}apple`.scope(scope)), '; ')}`
  for (const member of Object.values(result.atEach('member')))
    expect(member.completionNames).toEqual(['apple'])
  expect(programs).toHaveLength(2)
  expect(programs[0]).toBeDefined()
  expect(programs[1]).not.toBe(programs[0])
})
