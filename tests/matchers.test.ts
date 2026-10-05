import type { Diagnostic, Plugin } from '../src/types'
import { describe, expect, it } from 'vitest'
import { createProject, cursor, mark, snippet } from '../src/index'
import '../src/vitest'

function createDiagnostic(message: string, severity: Diagnostic['severity'] = 'error'): Diagnostic {
  return { code: 2322, severity, message, range: null, relatedInformation: [], codeFixes: [] }
}
function runFailingAssertion(runAssertion: () => unknown): string {
  try {
    runAssertion()
  }
  catch (error) {
    return (error as Error).message
  }
  throw new Error('assertion unexpectedly passed')
}

describe('suggestion promises', () => {
  it('shows the missing suggestion beside the fixture and observed names', () => {
    using project = createProject({ tsconfig: false })
    const result = project.query`const fruit = { apple: 1 }; fruit.${cursor('member')}`
    expect(result).toSuggest('apple')
    expect(runFailingAssertion(() => expect(result).toSuggest('pear'))).toBe(`expected cursor 'member' to suggest all of pear
  __selenita__.ts:1:35
  1 │ const fruit = { apple: 1 }; fruit.
    │                                   ^
  missing: pear
  suggested (1): apple`)
  })
  it('requires all named suggestions and forbids every negated name', () => {
    expect(['apple', 'kiwi']).toSuggest('apple')
    expect(['apple', 'kiwi']).toSuggest(['kiwi', 'apple'])
    expect(['apple', 'kiwi']).not.toSuggest(['pear', 'peach'])
    expect(() => expect(['apple']).not.toSuggest(['apple', 'pear'])).toThrow(/suggested anyway: apple/)
    expect(() => expect(['apple']).toSuggest(['apple', 'kiwi'])).toThrow(/missing: kiwi/)
    expect(['apple']).toEqual(expect.toSuggest('apple'))
    expect(['apple']).toEqual(expect.not.toSuggest(['pear', 'kiwi']))
    expect(() => expect(['apple']).toEqual(expect.not.toSuggest(['apple', 'kiwi']))).toThrow()
  })
  it('checks documentation only for requested names and reports every gap', () => {
    let detailCount = 0
    const plugin: Plugin = ({ typescript }) => ({ create(info) {
      return { ...info.languageService, getCompletionsAtPosition() {
        return { isGlobalCompletion: false, isMemberCompletion: true, isNewIdentifierLocation: false, entries: Array.from({ length: 50 }, (_, index) => ({ name: `fruit${index}`, kind: typescript.ScriptElementKind.memberVariableElement, sortText: '1' })) }
      }, getCompletionEntryDetails(file, offset, name) {
        detailCount++
        return { name, kind: typescript.ScriptElementKind.memberVariableElement, kindModifiers: '', displayParts: [], documentation: [{ text: name === 'fruit2' ? ' ' : 'Documented', kind: 'text' }] }
      } }
    } })
    using project = createProject({ tsconfig: false, plugins: [plugin] })
    const result = project.query`const fruit = { apple: 1 }; fruit.${cursor}`
    const failure = runFailingAssertion(() => expect(result).toSuggest(['fruit0', 'fruit1', 'fruit2', 'missing'], { requireDocumentation: true }))
    expect(failure).toContain('missing: missing')
    expect(failure).toContain('undocumented: fruit2')
    expect(detailCount).toBe(3)
    expect(() => expect(['fruit0']).toSuggest('fruit0', { requireDocumentation: true })).toThrow(/completion objects/)
    expect(() => expect(result).not.toSuggest('fruit0', { requireDocumentation: true })).toThrow(/cannot.*negat/)
  })
  it('requires documentation on every duplicate source occurrence', () => {
    const plugin: Plugin = ({ typescript }) => ({ create(info) {
      return { ...info.languageService, getCompletionsAtPosition() {
        return { isGlobalCompletion: false, isMemberCompletion: true, isNewIdentifierLocation: false, entries: ['one', 'two'].map(source => ({ name: 'fruit', source, kind: typescript.ScriptElementKind.constElement, sortText: '1' })) }
      }, getCompletionEntryDetails(file, offset, name, format, source) {
        return { name, kind: typescript.ScriptElementKind.constElement, kindModifiers: '', displayParts: [], documentation: [{ text: source === 'one' ? 'Documented' : '', kind: 'text' }] }
      } }
    } })
    using project = createProject({ tsconfig: false, plugins: [plugin] })
    const result = project.query`${cursor}`
    expect(() => expect(result).toSuggest('fruit', { requireDocumentation: true })).toThrow(/undocumented: fruit/)
  })
  it('compares exact sets without counting duplicates', () => {
    expect(['a', 'b', 'a']).toSuggestOnly(['b', 'a', 'b'])
    expect(['a']).not.toSuggestOnly(['b'])
    const failure = runFailingAssertion(() => expect(['a', 'internal']).toSuggestOnly(['a', 'missing']))
    expect(failure).toContain('missing: missing')
    expect(failure).toContain('unexpected: internal')
  })
  it('judges parity and rejects empty or single-member comparisons even when negated', () => {
    expect({ first: ['a', 'a', 'b'], second: ['b', 'a'] }).toHaveCompletionParity()
    expect({ first: ['a'], second: ['b'] }).not.toHaveCompletionParity()
    const failure = runFailingAssertion(() => expect({ first: ['a', 'b'], second: ['a', 'b'], other: ['c'] }).toHaveCompletionParity())
    expect(failure).toContain('baseline (first, second)')
    expect(failure).toContain('other: +c  -a, b')
    expect({ constructor: ['apple'], first: ['apple'] }).toHaveCompletionParity()
    const inheritedName = runFailingAssertion(() => expect({ constructor: ['apple'], first: ['apple'], other: ['kiwi'] }).toHaveCompletionParity())
    expect(inheritedName).toContain('baseline (constructor, first): apple')
    for (const members of [{}, { first: ['a'] }]) {
      expect(() => expect(members).toHaveCompletionParity()).toThrow(/two.*members[\s\S]*hint:/)
      expect(() => expect(members).not.toHaveCompletionParity()).toThrow(/two.*members/)
    }
  })
})

describe('diagnostic promises', () => {
  it('shows the expected file when a matching error underlines another file', () => {
    using project = createProject({ tsconfig: false })
    const result = project.check({
      'a.ts': snippet`export const ${mark('actual')`value`}: number = 'bad'`,
      'b.ts': snippet`export const ${mark('expected')`value`}: number = 1`,
    })
    const failure = runFailingAssertion(() => expect(result).toHaveError(2322, { on: result.rangeOf('expected') }))
    expect(failure).toContain(`expected underline\n  b.ts:1:${result.rangeOf('expected').start.column}`)
    expect(failure).toContain(`actual underline\n  a.ts:1:${result.rangeOf('actual').start.column}`)
    expect(result).toHaveError(2322, { on: result.rangeOf('actual') })
  })
  it('matches code, message and location, independently and together', () => {
    using project = createProject({ tsconfig: false })
    const result = project.check`declare function style(rule: { padding?: number }): void; style({ ${mark('typo')`paddin`}: 8 })`
    expect(result).toHaveErrorCount(1)
    expect(result.errors).toHaveError(2561)
    expect(result).toHaveError('paddin')
    expect(result).toHaveError(/padding/, { on: 'paddin' })
    expect(result).toHaveError(2561, /padding/, { on: result.rangeOf('typo') })
    expect(result).not.toHaveError(2322)
    expect(project.check`const value: number = 1`).toBeClean()
    expect(() => expect(result).toHaveError(2561, { on: { ...result.rangeOf('typo'), start: { ...result.rangeOf('typo').start, offset: 0 } } })).toThrow(/expected underline[\s\S]*actual underline/)
  })
  it('clones global and sticky regexes with their flags and leaves caller state alone', () => {
    const errors = [createDiagnostic('Type mismatch')]
    const globalPattern = /Type/g
    globalPattern.lastIndex = 5
    expect(errors).toHaveError(globalPattern)
    expect(errors).toHaveError(globalPattern)
    expect(globalPattern.lastIndex).toBe(5)
    const stickyPattern = /Type/y
    stickyPattern.lastIndex = 3
    expect(errors).toHaveError(stickyPattern)
    expect([createDiagnostic('Before Type mismatch')]).not.toHaveError(stickyPattern)
    expect(stickyPattern.lastIndex).toBe(3)
  })
  it('ignores non-error severities across every report matcher', () => {
    const diagnostics = [createDiagnostic('suggested', 'suggestion'), createDiagnostic('warned', 'warning'), createDiagnostic('message', 'message')]
    expect(diagnostics).toBeClean()
    expect(diagnostics).toHaveErrorCount(0)
    expect(diagnostics).not.toHaveError(/suggested|warned|message/)
    expect([...diagnostics, createDiagnostic('bad')]).toHaveErrorCount(1)
    expect(() => expect([createDiagnostic('bad')]).toBeClean()).toThrow(/bad/)
  })
  it('works with soft, async and asymmetric runner assertions', async () => {
    expect.soft(['apple']).toSuggest('apple')
    await expect(Promise.resolve(['apple'])).resolves.toSuggest('apple')
    // Arbitrary rejection values must also receive the matcher augmentation.
    // eslint-disable-next-line prefer-promise-reject-errors
    await expect(Promise.reject([createDiagnostic('bad')])).rejects.toHaveError('bad')
    expect([createDiagnostic('bad')]).toEqual(expect.toHaveError(2322, 'bad'))
    expect([createDiagnostic('bad')]).toEqual(expect.not.toHaveError('absent'))
  })
})

it('fails invalid receivers in both normal and negated forms', () => {
  expect(() => expect(42).toSuggest('a')).toThrow(/expects/)
  expect(() => expect(42).not.toSuggest('a')).toThrow(/expects/)
  expect(() => expect(42).toHaveError(1)).toThrow(/expects/)
  expect(() => expect(42).not.toBeClean()).toThrow(/expects/)
  expect(() => expect(42).toSuggestOnly(['a'])).toThrow(/expects/)
})
it('shows cursor and range excerpts, truncates names, and performs no requests while printing', () => {
  let requestCount = 0
  const plugin: Plugin = () => ({ create(info) {
    const service = info.languageService
    return { ...service, getCompletionsAtPosition(...args) {
      requestCount++
      return service.getCompletionsAtPosition(...args)
    }, getQuickInfoAtPosition() { throw new Error('unread hover') } }
  } })
  using project = createProject({ tsconfig: false, plugins: [plugin] })
  const result = project.query`\n  const fruit = { apple: 1 };\n  fruit.${cursor('member')}`
  const failure = runFailingAssertion(() => expect(result).toSuggest('kiwi'))
  expect(failure).toContain('cursor \'member\'')
  expect(failure).toContain('__selenita__.ts:3:9')
  expect(failure).toContain('│ fruit.')
  expect(failure).toContain('^')
  expect(requestCount).toBe(1)
  const rangeFailure = runFailingAssertion(() => expect(project.check`const value: number = 'bad'`).toBeClean())
  expect(rangeFailure).toContain('~~~~~')
  const names = Array.from({ length: 25 }, (_, index) => `name${index}`)
  const longFailure = runFailingAssertion(() => expect(names).toSuggest('missing'))
  expect(longFailure).toContain('5 more')
  expect(longFailure).not.toContain('name24')
  const parity = project.query`${snippet`const fruit = { apple: 1 }; fruit.${cursor('member')}`.scope('first')}; ${snippet`fruit.${cursor('member')}`.scope('second')}`
  expect(parity.atEach('member', ['first', 'second'])).toHaveCompletionParity()
})
