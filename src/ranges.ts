import type { Fixture } from './fixture'
import type { Point, Range, TextEdit } from './types'
import { isAbsolute, relative, resolve } from 'node:path'
import { SelenitaError } from './errors'

export const markerReference = Symbol('marker reference')
export const fixtureReference = Symbol('fixture reference')
export function createPoint(text: string, offset: number): Point {
  let line = 1
  let lineStart = 0
  for (const match of text.matchAll(/\r\n|[\r\n\u2028\u2029]/gu)) {
    const nextLineStart = match.index + match[0].length
    if (nextLineStart > offset)
      break
    line++
    lineStart = nextLineStart
  }
  return Object.freeze({ line, column: offset - lineStart + 1, offset })
}
export function createRange(root: string, file: string, text: string, start: number, length: number, fixture: Fixture): Range {
  const path = relative(root, file).replace(/\\/gu, '/')
  const range = { file: (path === '..' || path.startsWith('../') || isAbsolute(path) ? file : path).replace(/\\/gu, '/'), start: createPoint(text, start), end: createPoint(text, start + length), text: text.slice(start, start + length) }
  Object.defineProperty(range, fixtureReference, { value: fixture })
  return Object.freeze(range)
}

export function applyEdits(files: Readonly<Record<string, string>>, edits: readonly TextEdit[]): Readonly<Record<string, string>> {
  const fixedFiles = { ...files }
  const editsByFile = new Map<string, Array<TextEdit & { editIndex: number }>>()
  for (const [editIndex, edit] of edits.entries()) {
    const fileEdits = editsByFile.get(edit.range.file) ?? []
    fileEdits.push({ ...edit, editIndex })
    editsByFile.set(edit.range.file, fileEdits)
  }
  for (const [file, fileEdits] of editsByFile) {
    for (const [index, edit] of fileEdits.entries()) {
      if (fileEdits.slice(0, index).some(previous => edit.range.start.offset < previous.range.end.offset && previous.range.start.offset < edit.range.end.offset))
        throw new SelenitaError(`overlapping edits in '${file}'\n  hint: apply non-overlapping text edits in separate fixes`)
    }
    let text = fixedFiles[file] ?? ''
    for (const edit of fileEdits.sort((first, second) => second.range.start.offset - first.range.start.offset || second.editIndex - first.editIndex))
      text = text.slice(0, edit.range.start.offset) + edit.newText + text.slice(edit.range.end.offset)
    fixedFiles[file] = text
  }
  return Object.freeze(fixedFiles)
}

/** Source and underline for a located observation; source offsets stay untouched. */
export function formatExcerpt(range: Range): string {
  const fixture = (range as Range & { [fixtureReference]?: Fixture })[fixtureReference]
  const text = fixture?.files.get(resolve(fixture.root, range.file))?.text
  const header = `  ${range.file}:${range.start.line}:${range.start.column}`
  if (text === undefined)
    return header
  const lines = text.split(/\r\n|[\r\n\u2028\u2029]/u)
  const startLine = Math.max(1, range.start.line - (lines[range.start.line - 2]?.trim() ? 1 : 0))
  const endLine = Math.min(lines.length, Math.max(range.start.line, range.end.line), startLine + 4)
  const visibleLines = lines.slice(startLine - 1, endLine)
  const indentation = Math.min(...visibleLines.filter(line => line.trim()).map(line => line.match(/^\s*/u)![0].length), range.start.column - 1)
  const width = String(endLine).length
  const excerptLines: string[] = [header]
  for (let line = startLine; line <= endLine; line++) {
    const source = lines[line - 1]!
    excerptLines.push(`  ${String(line).padStart(width)} │ ${source.slice(indentation)}`)
    if (line >= range.start.line && line <= range.end.line) {
      const start = line === range.start.line ? range.start.column - 1 : indentation
      const end = line === range.end.line ? range.end.column - 1 : source.length
      const underline = range.start.offset === range.end.offset ? '^' : '~'.repeat(Math.max(1, end - start))
      excerptLines.push(`  ${' '.repeat(width)} │ ${' '.repeat(Math.max(0, start - indentation))}${underline}`)
    }
  }
  return excerptLines.join('\n')
}
