// Installed and executed by bun run test:package; expected ranges come only from marks.
import type { Plugin, QueryResult, Range } from '@mszr/selenita/vitest'
import { createProject, defineProject, mark, snippet } from '@mszr/selenita/vitest'
import { expect, it } from 'vitest'

const project = defineProject({ tsconfig: false })

it('keeps native module identity through a derived use and importing consumer', () => {
  const result = project.query({
    'colors.ts': snippet`export const colors = { ${mark('definition')`brand`}: '#635bff' }; export const soft = colors.${mark('derived')`brand`}`,
    'consumer.ts': snippet`import { colors } from './colors'; void colors.${mark('use')`brand`}`,
    'unrelated.ts': 'export const other = { brand: 0 }; void other.brand',
  })
  const expected = [result.rangeOf('definition'), result.rangeOf('derived'), result.rangeOf('use')]
  expect(result.at('definition').rename.locations).toEqual(expected)
  expect(result.at('use').rename.locations).toEqual(expected)
  expect(result).toBeClean()
})

// This fixture's fluent string definitions have no native TypeScript identity.
// The bridge discovers definitions/derived uses by AST and import symbols on each request.
// It does not receive expected ranges, marker names, or a fixed rename-location list.
const bridge: Plugin = ({ typescript }) => ({ create(info) {
  const service = info.languageService
  type Node = Parameters<typeof typescript.forEachChild>[0]
  interface BridgeLocation { identity: object, name: string, fileName: string, textSpan: { start: number, length: number } }
  function collectBridgeLocations(): BridgeLocation[] {
    const program = service.getProgram()
    if (!program)
      return []
    const checker = program.getTypeChecker()
    const locations: BridgeLocation[] = []
    function findIdentity(node: Node): object | undefined {
      const symbol = checker.getSymbolAtLocation(node)
      return symbol && (symbol.flags & typescript.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol)
    }
    for (const source of program.getSourceFiles()) {
      if (source.isDeclarationFile)
        continue
      function createLocation(node: Node, identity: object, name: string): void {
        const isString = typescript.isStringLiteral(node)
        const start = node.getStart(source) + (isString ? 1 : 0)
        locations.push({ identity, name, fileName: source.fileName, textSpan: { start, length: isString ? name.length : node.getWidth(source) } })
      }
      function createDeclarationLocations(node: Node): void {
        if (typescript.isVariableDeclaration(node) && typescript.isIdentifier(node.name) && node.initializer) {
          const identity = findIdentity(node.name)
          function createChainLocations(part: Node): void {
            if (identity && typescript.isCallExpression(part) && typescript.isPropertyAccessExpression(part.expression)) {
              if (part.expression.name.text === 'define' && part.arguments[0] && typescript.isStringLiteral(part.arguments[0]))
                createLocation(part.arguments[0], identity, part.arguments[0].text)
              if (part.expression.name.text === 'derive') {
                const callback = part.arguments[1]
                if (callback && typescript.isArrowFunction(callback) && callback.parameters[0]) {
                  const parameter = callback.parameters[0].name.getText(source)
                  function createDerivedLocations(child: Node): void {
                    if (typescript.isPropertyAccessExpression(child) && child.expression.getText(source) === parameter)
                      createLocation(child.name, identity!, child.name.text)
                    typescript.forEachChild(child, createDerivedLocations)
                  }
                  createDerivedLocations(callback.body)
                }
              }
              createChainLocations(part.expression.expression)
            }
          }
          createChainLocations(node.initializer)
        }
        typescript.forEachChild(node, createDeclarationLocations)
      }
      function createUseLocations(node: Node): void {
        if (typescript.isPropertyAccessExpression(node)) {
          const identity = findIdentity(node.expression)
          if (identity && locations.some(location => location.identity === identity && location.name === node.name.text))
            createLocation(node.name, identity, node.name.text)
        }
        typescript.forEachChild(node, createUseLocations)
      }
      createDeclarationLocations(source)
      createUseLocations(source)
    }
    return locations
  }
  function findBridgeTarget(locations: readonly BridgeLocation[], file: string, offset: number): BridgeLocation | undefined {
    return locations.find(location => location.fileName === file && location.textSpan.start <= offset && offset <= location.textSpan.start + location.textSpan.length)
  }
  return {
    ...service,
    getRenameInfo(file, offset, options) {
      const target = findBridgeTarget(collectBridgeLocations(), file, offset)
      return target ? { canRename: true, displayName: target.name, fullDisplayName: target.name, kind: typescript.ScriptElementKind.memberVariableElement, kindModifiers: '', triggerSpan: target.textSpan } : service.getRenameInfo(file, offset, options)
    },
    findRenameLocations(file, offset, shouldFindInStrings, shouldFindInComments, preferences) {
      const locations = collectBridgeLocations()
      const target = findBridgeTarget(locations, file, offset)
      if (target)
        return locations.filter(location => location.identity === target.identity && location.name === target.name).map(({ fileName, textSpan }) => ({ fileName, textSpan }))
      return typeof preferences === 'object'
        ? service.findRenameLocations(file, offset, shouldFindInStrings, shouldFindInComments, preferences)
        : service.findRenameLocations(file, offset, shouldFindInStrings, shouldFindInComments, preferences)
    },
  }
} })

const builderDeclaration = 'export declare function createKeys(): { define(name: string, value: string): ReturnType<typeof createKeys>; derive(name: string, value: (keys: Record<string, string>) => string): ReturnType<typeof createKeys>; [name: string]: unknown }'
const bridgeProject = defineProject({ tsconfig: false, files: { 'builder.d.ts': builderDeclaration }, plugins: [bridge] })
function createBuilderResult(name: string) {
  return bridgeProject.query({
    'colors.ts': snippet`import { createKeys } from './builder'; export const colors = createKeys().define('${mark('definition')`${name}`}', '#635bff').derive('soft', keys => keys.${mark('derived')`${name}`})`,
    'consumer.ts': snippet`import { colors } from './colors'; void colors.${mark('use')`${name}`}`,
    'unrelated.ts': snippet`import { createKeys } from './builder'; export const other = createKeys().define('${name}', 'black'); void other.${name}`,
  })
}
function runRenameAssertions(result: Pick<QueryResult<never, 'definition' | 'derived' | 'use'>, 'at' | 'rangeOf'>): readonly Range[] {
  const expected = [result.rangeOf('definition'), result.rangeOf('derived'), result.rangeOf('use')]
  expect(result.at('definition').rename.locations).toEqual(expected)
  expect(result.at('use').rename.locations).toEqual(expected)
  return expected
}
it('forwards custom fluent identity and reactivates the right source after swaps', () => {
  const first = createBuilderResult('brand')
  const second = createBuilderResult('accent')
  runRenameAssertions(second)
  const expected = runRenameAssertions(first)
  expect(expected.every(range => range.text === 'brand')).toBe(true)
  expect(first).toBeClean()
  using plain = createProject({ tsconfig: false, files: { 'builder.d.ts': builderDeclaration } })
  const native = plain.query({ 'colors.ts': snippet`import { createKeys } from './builder'; export const colors = createKeys().define('${mark('definition')`brand`}', 'black')` })
  expect(native.at('definition').rename.locations).toEqual([])
})
it('applies a native spelling fix while preserving an unrelated file', () => {
  const result = project.check({
    'fruit.ts': snippet`export const apple = 1; export const output = ${mark('typo')`appl`}`,
    'unrelated.ts': 'export const independent = 17',
  })
  expect(result).toHaveError(2552, /apple/, { on: result.rangeOf('typo') })
  const diagnostic = result.errors.find(error => error.code === 2552)!
  const fix = diagnostic.codeFixes.find(action => action.edits.some(edit => edit.newText === 'apple'))!
  expect(fix.edits).toContainEqual({ range: result.rangeOf('typo'), newText: 'apple' })
  expect(fix.fixedFiles['unrelated.ts']).toBe('export const independent = 17')
  expect(project.check(fix.fixedFiles)).not.toHaveError(2552)
  expect(project.check(fix.fixedFiles)).toBeClean()
})
