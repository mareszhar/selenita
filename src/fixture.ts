import type { Files, Interpolation } from './types'
import { resolve } from 'node:path'
import { SelenitaError } from './errors'
import { findMarkerSource } from './markers'
import { createVersion } from './typescript'

export interface FixtureFile { text: string, version: string, key: string }
export interface FixtureMarker { kind: 'cursor' | 'mark', name: string | null, file: string, start: number, end: number }
export interface Fixture { root: string, files: Map<string, FixtureFile>, markers: Map<string, FixtureMarker>, isBare: boolean }

export function createFixture(root: string, input: Files | TemplateStringsArray, values: readonly Interpolation[], mode: 'query' | 'check'): Fixture {
  const fixture: Fixture = { root, files: new Map(), markers: new Map(), isBare: false }
  let cursorCount = 0
  const sourceFiles: Record<string, unknown> = Array.isArray(input) && 'raw' in input
    ? { '__selenita__.ts': { strings: input, values } }
    : input as Files
  if (!sourceFiles || typeof sourceFiles !== 'object' || Array.isArray(sourceFiles))
    throw new SelenitaError('invalid fixture files\n  hint: pass a record of file names and source strings or snippets')

  for (const [key, source] of Object.entries(sourceFiles)) {
    const file = resolve(root, key).replace(/\\/gu, '/')
    if (fixture.files.has(file))
      throw new SelenitaError(`duplicate fixture file '${key}'\n  hint: use one key per resolved file path`)
    let text = ''
    function createMarker(kind: 'cursor' | 'mark', name: string | null): FixtureMarker {
      if (kind === 'cursor') {
        cursorCount++
        if (name === null)
          fixture.isBare = true
        if (fixture.isBare && cursorCount > 1)
          throw new SelenitaError('a bare cursor must be the only cursor\n  hint: name every cursor with cursor(name)')
      }
      const markerKey = name ?? ''
      if (fixture.markers.has(markerKey))
        throw new SelenitaError(`duplicate marker '${name}'\n  hint: use .scope(name) on reused snippets`)
      const marker = { kind, name, file, start: text.length, end: text.length }
      fixture.markers.set(markerKey, marker)
      return marker
    }
    function flattenInterpolation(value: unknown, scopes: readonly string[]): void {
      if (typeof value === 'string') {
        text += value
        return
      }
      if (Array.isArray(value)) {
        for (const element of value)
          flattenInterpolation(element, scopes)
        return
      }
      const markerSource = findMarkerSource(value)
      if (!markerSource)
        throw new SelenitaError(`invalid interpolation of type ${value === null ? 'null' : typeof value}\n  hint: use strings, cursors, marks, snippets, or arrays of them`)
      const nestedScopes = [...scopes, ...markerSource.scopes]
      const name = markerSource.name === null ? null : [...nestedScopes, markerSource.name].join('.')
      if (markerSource.kind === 'cursor') {
        createMarker('cursor', name)
        return
      }
      const marker = markerSource.kind === 'mark' ? createMarker('mark', name) : null
      flattenTemplate(markerSource.strings, markerSource.values, nestedScopes)
      if (marker)
        marker.end = text.length
    }
    function flattenTemplate(strings: readonly string[], interpolations: readonly unknown[], scopes: readonly string[]): void {
      for (const [index, part] of strings.entries()) {
        text += part
        if (index < interpolations.length)
          flattenInterpolation(interpolations[index], scopes)
      }
    }
    if (Array.isArray(input) && 'raw' in input)
      flattenTemplate(input, values, [])
    else
      flattenInterpolation(source, [])
    fixture.files.set(file, Object.freeze({ text, version: createVersion(), key }))
  }
  if (mode === 'check' && fixture.isBare)
    throw new SelenitaError('a check cannot refer to a bare cursor\n  hint: name the cursor, or use query for observations at it')
  if (mode === 'query' && fixture.markers.size === 0)
    throw new SelenitaError('a query needs a cursor or mark\n  hint: use check for file-wide observations without markers')
  return fixture
}
