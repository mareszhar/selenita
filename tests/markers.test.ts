import type { Interpolation } from '../src/types'
import { describe, expect, it } from 'vitest'
import { SelenitaError } from '../src/errors'
import { createFixture } from '../src/fixture'
import { cursor, mark, snippet } from '../src/markers'

const root = '/fixtures'
function query(strings: TemplateStringsArray, ...values: Interpolation[]) {
  return createFixture(root, strings, values, 'query')
}
function check(strings: TemplateStringsArray, ...values: Interpolation[]) {
  return createFixture(root, strings, values, 'check')
}

describe('fixture composition', () => {
  it('preserves every character and joins arrays without a separator', () => {
    const fixture = query`\n  ${['a', ['b', cursor('caret')], 'c']}\n`
    expect(fixture.files.get('/fixtures/__selenita__.ts')?.text).toBe('\n  abc\n')
    expect(fixture.markers.get('caret')).toMatchObject({ start: 5, end: 5 })
  })
  it('locates nested marks and cursors over the contributed text', () => {
    const fixture = query`😀${mark('call')`fn(${mark('argument')`${cursor('caret')}3`})`}`
    expect(fixture.files.get('/fixtures/__selenita__.ts')?.text).toBe('😀fn(3)')
    expect(fixture.markers.get('call')).toMatchObject({ start: 2, end: 7 })
    expect(fixture.markers.get('argument')).toMatchObject({ start: 5, end: 6 })
    expect(fixture.markers.get('caret')).toMatchObject({ start: 5, end: 5 })
  })
  it('composes scopes outside in and leaves the original snippet reusable', () => {
    const field = snippet`${mark('key')`x`}${cursor('caret')}`
    const outer = snippet`${field.scope('inner')}`
    const fixture = query`${outer.scope('ctx')}${field.scope('other')}`
    expect([...fixture.markers.keys()]).toEqual(['ctx.inner.key', 'ctx.inner.caret', 'other.key', 'other.caret'])
    expect([...query`${field}`.markers.keys()]).toEqual(['key', 'caret'])
    expect(Object.isFrozen(field)).toBe(true)
  })
  it('captures arrays when a snippet is built', () => {
    const values: Interpolation[] = ['a', cursor('caret')]
    const source = snippet`${values}`
    values[0] = 'changed'
    expect(query`${source}`.files.get('/fixtures/__selenita__.ts')?.text).toBe('a')
  })
  it('joins only outer members and keeps scoped markers over their exact text', () => {
    const first = snippet`${mark('key')`${cursor('caret')}😀`}`.scope('first')
    const second = snippet`${mark('key')`b`}${cursor('caret')}`.scope('second')
    const joined = snippet.join([first, ['(', second, ')']], '\n')
    const fixture = query`${mark('body')`${joined.scope('ctx')}`}`
    expect(fixture.files.get('/fixtures/__selenita__.ts')?.text).toBe('😀\n(b)')
    expect(fixture.markers.get('body')).toMatchObject({ start: 0, end: 6 })
    expect(fixture.markers.get('ctx.first.key')).toMatchObject({ start: 0, end: 2 })
    expect(fixture.markers.get('ctx.first.caret')).toMatchObject({ start: 0, end: 0 })
    expect(fixture.markers.get('ctx.second.key')).toMatchObject({ start: 4, end: 5 })
    expect(fixture.markers.get('ctx.second.caret')).toMatchObject({ start: 5, end: 5 })
    expect([...query`${first}`.markers.keys()]).toEqual(['first.key', 'first.caret'])
    expect(Object.isFrozen(joined)).toBe(true)
    expect(Object.isFrozen(snippet)).toBe(true)
  })
  it('joins empty and single-member lists without a separator and retains empty members', () => {
    expect(check`${snippet.join([], '\n')}`.files.get('/fixtures/__selenita__.ts')?.text).toBe('')
    const single = query`${snippet.join([snippet`${cursor('caret')}x`], '\n')}`
    expect(single.files.get('/fixtures/__selenita__.ts')?.text).toBe('x')
    expect(single.markers.get('caret')).toMatchObject({ start: 0, end: 0 })
    const emptyMembers = query`${snippet.join(['a', '', cursor('caret'), [], 'b'], '|')}`
    expect(emptyMembers.files.get('/fixtures/__selenita__.ts')?.text).toBe('a||||b')
    expect(emptyMembers.markers.get('caret')).toMatchObject({ start: 3, end: 3 })
    expect(check`${snippet.join(['a', 'b'], '')}`.files.get('/fixtures/__selenita__.ts')?.text).toBe('ab')
  })
  it('captures outer and nested arrays when joined source is built', () => {
    const inner: Interpolation[] = ['a', cursor('caret')]
    const parts: Interpolation[] = [inner, 'b']
    const joined = snippet.join(parts, ', ')
    inner[0] = 'changed'
    inner.push('extra')
    parts.push('extra')
    const fixture = query`${joined}`
    expect(fixture.files.get('/fixtures/__selenita__.ts')?.text).toBe('a, b')
    expect(fixture.markers.get('caret')).toMatchObject({ start: 1, end: 1 })
  })
  it('keeps interpolation and marker guards when joined snippets enter a fixture', () => {
    expect(() => query`${snippet.join([42 as never, cursor], '')}`).toThrow(/invalid interpolation[\s\S]*hint:/)
    // Sparse members must reach interpolation validation rather than silently disappearing.
    // eslint-disable-next-line unicorn/no-new-array
    expect(() => query`${snippet.join(new Array<Interpolation>(1), '')}${cursor}`).toThrow(/invalid interpolation.*undefined[\s\S]*hint:/)
    expect(() => query`${snippet.join([cursor('same'), mark('same')`x`], ', ')}`).toThrow(/duplicate.*same[\s\S]*hint:.*scope/)
    expect(() => query`${snippet.join([cursor, cursor('named')], '\n')}`).toThrow(/bare cursor[\s\S]*hint:/)
    expect(() => check`${snippet.join([cursor], '')}`).toThrow(/bare cursor[\s\S]*hint:/)
    expect(query`${snippet.join([cursor('first'), mark('second')`x`], '')}`.markers.size).toBe(2)
  })
  it.each([undefined, null, 42, 'source', {}])('rejects non-array join input %j with a hint', (parts) => {
    expect(() => snippet.join(parts as never, '\n')).toThrow(/join[\s\S]*hint:.*array/)
    expect(check`${snippet.join(['source'], '\n')}`.files.size).toBe(1)
  })
  it.each([undefined, null, 42, {}, cursor])('requires a string join separator instead of stringifying %j', (separator) => {
    expect(() => snippet.join(['source'], separator as never)).toThrow(/separator[\s\S]*hint:.*string/)
    expect(check`${snippet.join(['a', 'b'], '')}`.files.get('/fixtures/__selenita__.ts')?.text).toBe('ab')
  })
  it('resolves record keys and keeps each marker in its own file', () => {
    const fixture = createFixture(root, { 'src/a.ts': snippet`${mark('definition')`x`}`, '/outside/use.ts': snippet`${cursor('use')}x`, 'plain.ts': 'export {}' }, [], 'query')
    expect([...fixture.files.keys()]).toEqual(['/fixtures/src/a.ts', '/outside/use.ts', '/fixtures/plain.ts'])
    expect(fixture.markers.get('use')?.file).toBe('/outside/use.ts')
    expect(fixture.files.get('/fixtures/plain.ts')?.text).toBe('export {}')
  })
  it('accepts marks and named cursors as locations in a check', () => {
    const fixture = check`${mark('typo')`wrong`}${cursor('end')}`
    expect([...fixture.markers.keys()]).toEqual(['typo', 'end'])
    expect(check`valid`.files.size).toBe(1)
  })
  it('gives a fixture a stable unique content version', () => {
    const first = check`a`
    const second = check`b`
    const firstVersion = first.files.get('/fixtures/__selenita__.ts')?.version
    expect(firstVersion).toEqual(expect.any(String))
    expect(firstVersion).not.toBe(second.files.get('/fixtures/__selenita__.ts')?.version)
    expect(first.files.get('/fixtures/__selenita__.ts')?.version).toBe(firstVersion)
  })
})

describe('marker rules', () => {
  it.each(['', 'a.b', 'a b', ' x', '\n'])('rejects invalid marker name %j at construction', (name) => {
    expect(() => cursor(name)).toThrow(/hint:.*segment/)
    expect(() => mark(name)).toThrow(SelenitaError)
    expect(cursor('key')).toBeDefined()
    expect(mark('key')).toBeTypeOf('function')
  })
  it('checks scope names while allowing dots in a scope', () => {
    const source = snippet`${cursor('member')}`
    expect(() => source.scope('')).toThrow(/hint:.*non-empty/)
    expect([...query`${source.scope('db.findMany')}`.markers.keys()]).toEqual(['db.findMany.member'])
  })
  it('rejects duplicate names across all fixture files with a scoping hint', () => {
    expect(() => createFixture(root, { 'a.ts': snippet`${mark('same')`a`}`, 'b.ts': snippet`${cursor('same')}` }, [], 'query')).toThrow(/duplicate.*same[\s\S]*hint:.*scope/)
    expect(query`${cursor('first')}${cursor('second')}`.markers.size).toBe(2)
  })
  it('requires a bare cursor to be the only cursor', () => {
    expect(() => query`${cursor}${cursor('named')}`).toThrow(/hint:.*name every cursor/)
    expect(() => query`${cursor}${cursor}`).toThrow(/hint:.*name every cursor/)
    expect(query`${cursor}${mark('key')`x`}`.isBare).toBe(true)
  })
  it('rejects bare cursors in checks and accepts named locations', () => {
    expect(() => check`${cursor}`).toThrow(/hint:.*name.*query/)
    expect(check`${cursor('caret')}`.markers.size).toBe(1)
  })
  it('requires a query to ask at a cursor or mark', () => {
    expect(() => query`no markers`).toThrow(/hint:.*check/)
    expect(query`${mark('key')`x`}`.markers.size).toBe(1)
  })
  it.each([42, null, undefined, {}, true, () => {}])('rejects invalid interpolation %j with its type and a hint', (value) => {
    expect(() => query`${value as Interpolation}${cursor}`).toThrow(/invalid interpolation[\s\S]*hint:/)
    expect(() => check`${value as Interpolation}`).toThrow(SelenitaError)
    expect(check`${'source'}`.files.size).toBe(1)
  })
})
