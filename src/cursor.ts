// ── Cursor primitive ────────────────────────────────────────────────────────
//
// `cursor` is both a bare interpolation value (unnamed, single-cursor case)
// and a callable (named, multi-cursor case):
//
//   cursor          — unnamed cursor
//   cursor('root')  — named cursor

export const CURSOR_SENTINEL: unique symbol = Symbol.for('selenita.cursor')

export interface CursorValue {
  readonly [CURSOR_SENTINEL]: true
  readonly cursorName: string
}

/** The full `cursor` export — callable for named cursors, usable bare for unnamed. */
export type Cursor = CursorValue & {
  readonly cursorName: '__unnamed__'
  (name: string): CursorValue
}

function namedCursor(name: string): CursorValue {
  const value: CursorValue = { [CURSOR_SENTINEL]: true as const, cursorName: name }
  return Object.freeze(value)
}

/**
 * Mark a position inside a `project.query` template literal for language-service
 * interrogation (completions, hover, signature help, etc.).
 *
 * **Unnamed cursor** — for the simple single-cursor case. Access results directly
 * on the returned object:
 * ```ts
 * const { completions } = project.query`
 *   import { registerFruit } from './src'
 *   registerFruit({ ${cursor} })
 * `
 * ```
 *
 * **Named cursor** — required when a query contains more than one cursor. Use
 * `result.at('name')` to access each cursor's data:
 * ```ts
 * const result = project.query`
 *   registerFruit({ ${cursor('empty')} })
 *   registerFruit({ name: 'apple', ${cursor('remaining')} })
 * `
 * result.at('empty').completions    // all Fruit keys
 * result.at('remaining').completions // only the ones not yet filled in
 * ```
 *
 * `cursor` is meaningful only inside `project.query` or `snippet` tagged templates.
 * Using it elsewhere is a no-op — the value is ignored and no query is performed for it.
 */
export const cursor: Cursor = Object.assign(namedCursor, {
  [CURSOR_SENTINEL]: true as const,
  cursorName: '__unnamed__' as const,
}) as Cursor

// ── Guards ──────────────────────────────────────────────────────────────────

export function isCursor(value: unknown): value is CursorValue {
  return (
    value !== null
    && (typeof value === 'function' || typeof value === 'object')
    && CURSOR_SENTINEL in (value as object)
    && (value as Record<typeof CURSOR_SENTINEL, unknown>)[CURSOR_SENTINEL] === true
  )
}

export function isUnnamedCursor(value: unknown): value is Cursor {
  return isCursor(value) && value.cursorName === '__unnamed__'
}
