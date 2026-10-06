import type { CursorsOf, Interpolation, MarksOf } from './types'
import { version } from '../package.json'
import { SelenitaError } from './errors'

// A well-known symbol keeps phantom name types structural across package peer contexts.
export interface Cursor<Name extends string = string> {
  readonly [Symbol.toStringTag]: 'selenita.cursor' & { readonly name: Name }
}
export interface Mark<Name extends string = string, Cursors extends string = string, Marks extends string = string> {
  readonly [Symbol.toStringTag]: 'selenita.mark' & { readonly names: readonly [Name, Cursors, Marks] }
}
export interface Snippet<Cursors extends string = string, Marks extends string = string> {
  readonly [Symbol.toStringTag]: 'selenita.snippet' & { readonly names: readonly [Cursors, Marks] }
  /** Prefix this snippet's marker names so related examples can be observed together. */
  readonly scope: <const Name extends string>(name: Name) => Snippet<`${Name}.${Cursors}`, `${Name}.${Marks}`>
}
export interface MarkerSource {
  kind: 'cursor' | 'mark' | 'snippet'
  name: string | null
  strings: readonly string[]
  values: readonly Interpolation[]
  scopes: readonly string[]
}
const markerSource = Symbol.for('@mszr/selenita.marker')
export function findMarkerSource(value: unknown): MarkerSource | undefined {
  if (value === null || (typeof value !== 'object' && typeof value !== 'function') || !(markerSource in value))
    return undefined
  const identity = (value as { [markerSource]: { version: string, source: MarkerSource } })[markerSource]
  if (identity.version !== version)
    throw new SelenitaError(`marker from @mszr/selenita ${identity.version} in a project from ${version}\n  hint: install one version of @mszr/selenita, or import cursor, mark, and snippet from the package that creates the project`)
  return identity.source
}
function createMarker<Value extends object>(value: Value, source: MarkerSource): Value {
  Object.defineProperty(value, markerSource, { value: Object.freeze({ version, source: Object.freeze({ ...source, scopes: Object.freeze([...source.scopes]) }) }) })
  return Object.freeze(value)
}
function createCursor<const Name extends string>(name: Name): Cursor<Name> {
  validateMarkerName(name)
  return createMarker({ [Symbol.toStringTag]: 'selenita.cursor' as Cursor<Name>[typeof Symbol.toStringTag] }, { kind: 'cursor', name, strings: [], values: [], scopes: [] })
}
/** Where the editor's caret is. Interpolate `cursor` for one question, or `cursor(name)` to ask at several places. */
export const cursor = createMarker(Object.assign(createCursor, { [Symbol.toStringTag]: 'selenita.cursor' as never }), { kind: 'cursor', name: null, strings: [], values: [], scopes: [] }) as Cursor<never> & (<const Name extends string>(name: Name) => Cursor<Name>)
/** Names fixture text: ``mark(name)`text` `` locates it for `rangeOf` and exact error assertions, and observes at its start. */
export function mark<const Name extends string>(name: Name) {
  validateMarkerName(name)
  return <const Values extends readonly Interpolation[]>(strings: TemplateStringsArray, ...values: Values): Mark<Name, CursorsOf<Values>, MarksOf<Values>> => {
    return createMarker({ [Symbol.toStringTag]: 'selenita.mark' as Mark<Name, CursorsOf<Values>, MarksOf<Values>>[typeof Symbol.toStringTag] }, { kind: 'mark', name, strings: Object.freeze([...strings]), values: createInterpolations(values), scopes: [] })
  }
}
function createSnippet<Cursors extends string, Marks extends string>(source: MarkerSource): Snippet<Cursors, Marks> {
  const value: Snippet<Cursors, Marks> = {
    [Symbol.toStringTag]: 'selenita.snippet' as Snippet<Cursors, Marks>[typeof Symbol.toStringTag],
    scope(name) {
      if (typeof name !== 'string' || !name.length)
        throw new SelenitaError(`invalid scope '${String(name)}'\n  hint: use a non-empty string for the scope`)
      return createSnippet({ ...source, scopes: [name, ...source.scopes] })
    },
  }
  return createMarker(value, source)
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
