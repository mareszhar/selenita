import { isCursor } from './cursor'
import { isScopedSnippet, isSnippet, resolveSnippet } from './snippet'

// ── Parsed template output ──────────────────────────────────────────────────

export interface ParsedTemplate {
  /** The virtual file source code, with all cursors removed (zero-width). */
  code: string
  /** Cursor name → character offset within `code`. */
  cursors: Map<string, number>
  /** Whether the query had exactly one unnamed cursor. */
  isUnnamed: boolean
}

// ── Template parser ─────────────────────────────────────────────────────────

export function parseQueryTemplate(
  strings: TemplateStringsArray,
  values: unknown[],
): ParsedTemplate {
  let code = ''
  const cursorEntries: Array<{ name: string, position: number }> = []

  for (let i = 0; i < strings.length; i++) {
    code += strings[i] ?? ''

    if (i < values.length) {
      const v = values[i]

      if (isCursor(v)) {
        cursorEntries.push({ name: v.cursorName, position: code.length })
      }
      else if (isSnippet(v)) {
        const resolved = resolveSnippet(v, '')
        appendSnippetCursors(resolved.cursors, code.length, cursorEntries)
        code += resolved.text
      }
      else if (isScopedSnippet(v)) {
        const resolved = resolveSnippet(v.snippet, v.alias)
        appendSnippetCursors(resolved.cursors, code.length, cursorEntries)
        code += resolved.text
      }
      else if (typeof v === 'string') {
        code += v
      }
      else {
        throw new TypeError(
          `selenita: invalid interpolation in query template — expected cursor, snippet, or string, got ${typeof v}.\n`
          + `Tip: only cursor, cursor('name'), snippet\`...\`, and string values may be interpolated into project.query\`...\`.`,
        )
      }
    }
  }

  validateCursorEntries(cursorEntries)

  const cursors = new Map(cursorEntries.map(c => [c.name, c.position]))
  const isUnnamed = cursorEntries.length === 1 && cursorEntries[0]!.name === '__unnamed__'

  return { code, cursors, isUnnamed }
}

/** Simpler parse for project.check — no cursors allowed/expected. */
export function parseCheckTemplate(
  strings: TemplateStringsArray,
  values: unknown[],
): string {
  let code = ''

  for (let i = 0; i < strings.length; i++) {
    code += strings[i] ?? ''

    if (i < values.length) {
      const v = values[i]

      if (isSnippet(v)) {
        code += resolveSnippet(v, '').text
      }
      else if (isScopedSnippet(v)) {
        code += resolveSnippet(v.snippet, v.alias).text
      }
      else if (typeof v === 'string') {
        code += v
      }
      else if (isCursor(v)) {
        throw new Error(
          `selenita: cursor is not valid inside project.check\`...\`. `
          + `Use project.query\`...\` when you need language-service queries at a cursor position.`,
        )
      }
      else {
        throw new Error(
          `selenita: invalid interpolation in check template — expected snippet or string, got ${typeof v}.`,
        )
      }
    }
  }

  return code
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function appendSnippetCursors(
  snippetCursors: Array<{ name: string, position: number }>,
  offset: number,
  out: Array<{ name: string, position: number }>,
): void {
  for (const c of snippetCursors) {
    out.push({ name: c.name, position: offset + c.position })
  }
}

export function validateCursorEntries(entries: Array<{ name: string, position: number }>): void {
  if (entries.length === 0) {
    throw new Error(
      `selenita: project.query\`...\` requires at least one cursor interpolation. `
      + `Use project.check\`...\` for diagnostic-only queries without a cursor.`,
    )
  }

  const hasUnnamed = entries.some(c => c.name === '__unnamed__')
  const hasNamed = entries.some(c => c.name !== '__unnamed__')

  if (hasUnnamed && hasNamed) {
    throw new Error(
      `selenita: Mixed cursor types detected — bare cursor cannot be used alongside named cursors. `
      + `Replace bare cursor with cursor('name') for all positions.`,
    )
  }

  if (entries.length > 1 && hasUnnamed) {
    throw new Error(
      `selenita: Multiple bare cursors found — each cursor in a multi-cursor query must be named. `
      + `Replace cursor with cursor('name') for each position.`,
    )
  }

  const seen = new Set<string>()
  for (const { name } of entries) {
    if (seen.has(name)) {
      throw new Error(
        `selenita: Duplicate cursor name '${name}' — each cursor in a query must have a unique name. `
        + `Use .for('alias') to scope reused snippets.`,
      )
    }
    seen.add(name)
  }
}
