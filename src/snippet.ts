import type { CursorValue } from './cursor'
import { isCursor } from './cursor'

// ── Internal representation ─────────────────────────────────────────────────

type Part
  = | { kind: 'text', text: string }
    | { kind: 'cursor', value: CursorValue }
    | { kind: 'snippet', value: SnippetValue, alias: string | null }

/** Resolved snippet: the flattened text plus cursor positions relative to its start. */
export interface ResolvedSnippet {
  text: string
  cursors: Array<{ name: string, position: number }>
}

// ── Snippet value ───────────────────────────────────────────────────────────

export const SNIPPET_SENTINEL: unique symbol = Symbol.for('selenita.snippet')

/**
 * A reusable code fragment carrying its own named cursors.
 * Scope a snippet for multi-use via `.for('alias')`.
 */
export interface SnippetValue {
  /**
   * Scope this snippet under an alias when embedding it at multiple positions
   * inside the same query, so cursor paths stay unique.
   *
   * ```ts
   * const result = project.query`
   *   db.queryOnce(${whereClause.for('once')})
   *   db.useQuery(${whereClause.for('hook')})
   * `
   * result.at('once.where').completions
   * result.at('hook.where').completions
   * ```
   */
  for: (alias: string) => ScopedSnippet
}

// Internal type that carries the runtime fields — never part of the public API.
type SnippetInternal = SnippetValue & {
  readonly [SNIPPET_SENTINEL]: true
  readonly parts: readonly Part[]
}

export interface ScopedSnippet {
  readonly snippet: SnippetValue
  readonly alias: string
}

function createSnippet(parts: readonly Part[]): SnippetValue {
  const s: SnippetInternal = {
    [SNIPPET_SENTINEL]: true,
    parts,
    for(alias: string): ScopedSnippet {
      return { snippet: s, alias }
    },
  }
  return s
}

// ── Guards ──────────────────────────────────────────────────────────────────

export function isSnippet(value: unknown): value is SnippetValue {
  return (
    value !== null
    && typeof value === 'object'
    && SNIPPET_SENTINEL in (value as object)
    && (value as Record<typeof SNIPPET_SENTINEL, unknown>)[SNIPPET_SENTINEL] === true
  )
}

export function isScopedSnippet(value: unknown): value is ScopedSnippet {
  return (
    value !== null
    && typeof value === 'object'
    && 'snippet' in (value as object)
    && 'alias' in (value as object)
    && isSnippet((value as ScopedSnippet).snippet)
  )
}

// ── Tagged template tag ─────────────────────────────────────────────────────

/**
 * Define a reusable, composable code fragment that carries its own cursors.
 *
 * A snippet is inert until it is interpolated into a `project.query` or another
 * `snippet`. Its cursors are captured at definition time and resolved when the
 * snippet is expanded.
 *
 * **Basic use:**
 * ```ts
 * const whereClause = snippet`{ status: 'open', ${cursor('where')} }`
 * const queryCall   = snippet`db.queryOnce(${whereClause})`
 * ```
 *
 * **Reuse with `.for()` to namespace cursor paths:**
 * ```ts
 * const result = project.query`
 *   import { db } from './src'
 *   db.queryOnce(${whereClause.for('once')})
 *   db.useQuery(${whereClause.for('hook')})
 * `
 * result.at('once.where').completions
 * result.at('hook.where').completions
 * ```
 *
 * **Composition — snippets can embed other snippets:**
 * ```ts
 * const inner = snippet`{ ${cursor('field')} }`
 * const outer = snippet`{ nested: ${inner.for('inner')} }`
 * // cursor path in a query: 'inner.field'
 * ```
 */
export function snippet(
  strings: TemplateStringsArray,
  ...values: Array<CursorValue | SnippetValue | ScopedSnippet | string>
): SnippetValue {
  const parts: Part[] = []

  for (let i = 0; i < strings.length; i++) {
    const text = strings[i]
    if (text)
      parts.push({ kind: 'text', text })

    if (i < values.length) {
      const v = values[i] as CursorValue | SnippetValue | ScopedSnippet | string
      if (isCursor(v)) {
        parts.push({ kind: 'cursor', value: v })
      }
      else if (isSnippet(v)) {
        parts.push({ kind: 'snippet', value: v, alias: null })
      }
      else if (isScopedSnippet(v)) {
        parts.push({ kind: 'snippet', value: v.snippet, alias: v.alias })
      }
      else if (typeof v === 'string') {
        parts.push({ kind: 'text', text: v })
      }
      else {
        throw new TypeError(
          `selenita snippet: invalid interpolation — expected cursor, snippet, or string, got ${typeof v}`,
        )
      }
    }
  }

  return createSnippet(parts)
}

// ── Resolution ──────────────────────────────────────────────────────────────

/**
 * Recursively resolve a snippet into flat text + cursor positions.
 * `prefix` is the dot-joined path accumulated by .for() calls above this snippet.
 */
export function resolveSnippet(value: SnippetValue, prefix: string): ResolvedSnippet {
  let text = ''
  const cursors: Array<{ name: string, position: number }> = []

  for (const part of (value as SnippetInternal).parts) {
    if (part.kind === 'text') {
      text += part.text
    }
    else if (part.kind === 'cursor') {
      const name = prefix ? `${prefix}.${part.value.cursorName}` : part.value.cursorName
      cursors.push({ name, position: text.length })
    }
    else {
      // Nested snippet: compute child prefix from the alias (if any) + current prefix
      const childPrefix = part.alias
        ? (prefix ? `${prefix}.${part.alias}` : part.alias)
        : prefix

      const resolved = resolveSnippet(part.value, childPrefix)

      for (const c of resolved.cursors) {
        cursors.push({ name: c.name, position: text.length + c.position })
      }
      text += resolved.text
    }
  }

  return { text, cursors }
}
