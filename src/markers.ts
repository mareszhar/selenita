import type { CursorsOf, Interpolation, MarksOf } from './types'
import { SelenitaError } from './errors'

const cursorNames: unique symbol = Symbol('cursor names')
const markNames: unique symbol = Symbol('mark names')
const snippetNames: unique symbol = Symbol('snippet names')
export interface Cursor<Name extends string = string> { readonly [cursorNames]: Name }
export interface Mark<Name extends string = string, Cursors extends string = string, Marks extends string = string> { readonly [markNames]: readonly [Name, Cursors, Marks] }
export interface Snippet<Cursors extends string = string, Marks extends string = string> {
  readonly [snippetNames]: readonly [Cursors, Marks]
  readonly scope: <const Name extends string>(name: Name) => Snippet<`${Name}.${Cursors}`, `${Name}.${Marks}`>
}
export interface MarkerSource {
  kind: 'cursor' | 'mark' | 'snippet'
  name: string | null
  strings: readonly string[]
  values: readonly Interpolation[]
  scopes: readonly string[]
}
const markerSources = new WeakMap<object, MarkerSource>()
export function findMarkerSource(value: unknown): MarkerSource | undefined {
  return value !== null && (typeof value === 'object' || typeof value === 'function') ? markerSources.get(value) : undefined
}
function createCursor<const Name extends string>(name: Name): Cursor<Name> {
  validateMarkerName(name)
  const value = Object.freeze({ [cursorNames]: name })
  markerSources.set(value, { kind: 'cursor', name, strings: [], values: [], scopes: [] })
  return value
}
export const cursor = Object.freeze(Object.assign(createCursor, { [cursorNames]: undefined as never })) as Cursor<never> & (<const Name extends string>(name: Name) => Cursor<Name>)
markerSources.set(cursor, { kind: 'cursor', name: null, strings: [], values: [], scopes: [] })
export function mark<const Name extends string>(name: Name) {
  validateMarkerName(name)
  return <const Values extends readonly Interpolation[]>(strings: TemplateStringsArray, ...values: Values): Mark<Name, CursorsOf<Values>, MarksOf<Values>> => {
    const value = Object.freeze({ [markNames]: undefined as unknown as readonly [Name, CursorsOf<Values>, MarksOf<Values>] })
    markerSources.set(value, { kind: 'mark', name, strings: Object.freeze([...strings]), values: createInterpolations(values), scopes: [] })
    return value
  }
}
function createSnippet<Cursors extends string, Marks extends string>(source: MarkerSource): Snippet<Cursors, Marks> {
  const value: Snippet<Cursors, Marks> = {
    [snippetNames]: undefined as unknown as readonly [Cursors, Marks],
    scope(name) {
      if (typeof name !== 'string' || !name.length)
        throw new SelenitaError(`invalid scope '${String(name)}'\n  hint: use a non-empty string for the scope`)
      return createSnippet({ ...source, scopes: [name, ...source.scopes] })
    },
  }
  markerSources.set(value, source)
  return Object.freeze(value)
}
function createSnippetTemplate<const Values extends readonly Interpolation[]>(strings: TemplateStringsArray, ...values: Values): Snippet<CursorsOf<Values>, MarksOf<Values>> {
  return createSnippet({ kind: 'snippet', name: null, strings: Object.freeze([...strings]), values: createInterpolations(values), scopes: [] })
}

/** Join fixture source with an explicit separator between members, preserving markers and their names. */
function joinSnippets<const Values extends readonly Interpolation[]>(parts: Values, separator: string): Snippet<CursorsOf<Values>, MarksOf<Values>> {
  if (!Array.isArray(parts))
    throw new SelenitaError('invalid snippet.join parts\n  hint: pass an array of strings, cursors, marks, or snippets')
  if (typeof separator !== 'string')
    throw new SelenitaError('invalid snippet.join separator\n  hint: pass a string separator, such as \"\\n\" or \"\", explicitly')
  const values: Interpolation[] = []
  for (const [index, part] of parts.entries()) {
    if (index > 0)
      values.push(separator)
    values.push(part)
  }
  return createSnippet({
    kind: 'snippet',
    name: null,
    strings: Object.freeze(['', '']),
    values: createInterpolations([values]),
    scopes: [],
  })
}

/** Reusable fixture source carrying markers; join fragments with snippet.join(parts, separator). */
export const snippet: typeof createSnippetTemplate & {
  /** Join fixture source with an explicit separator between members, preserving markers and their names. */
  readonly join: typeof joinSnippets
} = Object.freeze(Object.assign(createSnippetTemplate, { join: joinSnippets }))

function createInterpolations(values: readonly Interpolation[]): readonly Interpolation[] {
  return Object.freeze(values.map(value => Array.isArray(value) ? createInterpolations(value) : value))
}
function validateMarkerName(name: string): void {
  if (typeof name !== 'string' || !name.length || /[.\s]/u.test(name))
    throw new SelenitaError(`invalid marker name '${String(name)}'\n  hint: use one non-empty segment without dots or whitespace`)
}
