import type { GroupValue } from './group'
import type { SelenitaHost } from './host'
import type { SnippetValue } from './snippet'
import type {
  CheckResult,
  CompletionItem,
  CompletionItemKind,
  Diagnostic,
  DivergenceReport,
  GroupCursorResult,
  GroupQueryResult,
  InlayHint,
  QueryResult,
  SignatureHelp,
  SingleCursorResult,
} from './types'
import * as ts from 'typescript'
import { resolveSnippet } from './snippet'
import { parseCheckTemplate, parseQueryTemplate, validateCursorEntries } from './template'

// ── Virtual file naming ─────────────────────────────────────────────────────

let queryCounter = 0

export function makeVirtualFileName(projectRoot: string): string {
  return `${projectRoot}/__selenita_query_${++queryCounter}__.ts`
}

// ── Main query runner ───────────────────────────────────────────────────────

export interface QueryMeta {
  fileName: string
  cursors: Map<string, number>
}

export function runQuery(
  ls: ts.LanguageService,
  host: SelenitaHost,
  projectRoot: string,
  strings: TemplateStringsArray,
  values: unknown[],
  onMeta?: (meta: QueryMeta) => void,
): QueryResult {
  const parsed = parseQueryTemplate(strings, values)
  const fileName = makeVirtualFileName(projectRoot)

  host.setVirtualFile(fileName, parsed.code)
  onMeta?.({ fileName, cursors: parsed.cursors })

  // The virtual file is intentionally NOT deleted here. Project.query() deletes
  // the previous file before each new query, keeping the current file alive so
  // that the project.languageService escape hatch can be used after the call
  // (project.lastVirtualFileName / project.positionOf() → LS method).

  const diagnostics = collectDiagnostics(ls, fileName, parsed.code)

  if (parsed.isUnnamed) {
    const position = parsed.cursors.get('__unnamed__')!
    const single = buildSingleCursorResult(ls, fileName, parsed.code, position, diagnostics)
    return {
      ...single,
      at(_cursorName: string): SingleCursorResult {
        throw new Error(
          `selenita: .at() is not valid for unnamed-cursor queries — access results directly (e.g. result.completions).`,
        )
      },
    }
  }

  if (parsed.cursors.size === 1) {
    const [name, position] = [...parsed.cursors.entries()][0]!
    const single = buildSingleCursorResult(ls, fileName, parsed.code, position, diagnostics)
    return {
      ...single,
      at: (cursorName: string) => {
        if (cursorName !== name) {
          throw new Error(`selenita: cursor '${cursorName}' not found — this query has one cursor named '${name}'.`)
        }
        return single
      },
    }
  }

  // Multi-cursor path.
  const inlayHints = collectInlayHints(ls, fileName, parsed.code)
  const resultMap = new Map<string, SingleCursorResult>()
  for (const [name, position] of parsed.cursors) {
    resultMap.set(name, buildSingleCursorResult(ls, fileName, parsed.code, position, diagnostics, inlayHints))
  }

  const at = (cursorName: string): SingleCursorResult => {
    const result = resultMap.get(cursorName)
    if (!result) {
      const names = [...parsed.cursors.keys()].join(', ')
      throw new Error(`selenita: cursor '${cursorName}' not found — available cursors: ${names}`)
    }
    return result
  }

  return {
    at,
    completions: [],
    completionItems: [],
    completionItem: () => undefined,
    completionItemsOfKind: () => [],
    hover: null,
    signatureHelp: null,
    diagnostics,
    errors: diagnostics.filter(d => d.severity === 'error'),
    warnings: diagnostics.filter(d => d.severity === 'warning'),
    inlayHints,
  } satisfies QueryResult
}

export function runCheck(
  ls: ts.LanguageService,
  host: SelenitaHost,
  projectRoot: string,
  strings: TemplateStringsArray,
  values: unknown[],
): CheckResult {
  const code = parseCheckTemplate(strings, values)
  const fileName = makeVirtualFileName(projectRoot)

  host.setVirtualFile(fileName, code)

  try {
    const diagnostics = collectDiagnostics(ls, fileName, code)
    const inlayHints = collectInlayHints(ls, fileName, code)

    return {
      diagnostics,
      errors: diagnostics.filter(d => d.severity === 'error'),
      warnings: diagnostics.filter(d => d.severity === 'warning'),
      inlayHints,
    }
  }
  finally {
    host.deleteVirtualFile(fileName)
  }
}

// ── Group query ─────────────────────────────────────────────────────────────

export function runQueryGroup(
  ls: ts.LanguageService,
  host: SelenitaHost,
  projectRoot: string,
  groupValue: GroupValue,
  factory: (api: string) => SnippetValue,
  preludeStrings: TemplateStringsArray,
  preludeValues: unknown[],
): GroupQueryResult {
  // Build the prelude
  let prelude = ''
  for (let i = 0; i < preludeStrings.length; i++) {
    prelude += preludeStrings[i] ?? ''
    if (i < preludeValues.length) {
      const v = preludeValues[i]
      if (typeof v === 'string') {
        prelude += v
      }
      else {
        throw new TypeError(
          `selenita: invalid interpolation in queryGroup prelude — only string values are allowed, got ${typeof v}.\n`
          + `Tip: the prelude is for imports and shared declarations only. Use the snippet factory for cursor positions.`,
        )
      }
    }
  }

  // Assemble the virtual file with one call per group member
  // Each member's cursors are automatically scoped to `{apiName}.{cursorName}`
  const fileName = makeVirtualFileName(projectRoot)

  interface MemberData { api: string, cursors: Map<string, number> }
  const memberData: MemberData[] = []

  let code = `${prelude}\n`

  for (const api of groupValue.members) {
    const memberSnippet = factory(api)
    const resolved = resolveSnippet(memberSnippet, api)

    // Validate cursor names within this member using bare names (without the api prefix).
    // This enforces the same duplicate-name contract that project.query enforces.
    const bareEntries = resolved.cursors.map(c => ({
      name: c.name.startsWith(`${api}.`) ? c.name.slice(api.length + 1) : c.name,
      position: c.position,
    }))

    if (bareEntries.length === 0) {
      throw new Error(
        `selenita: group member '${api}': factory returned a snippet with no cursors. `
        + `Add at least one cursor('name') so results can be accessed via result.for('${api}').at('name').`,
      )
    }

    const unnamedEntry = bareEntries.find(e => e.name === '__unnamed__')
    if (unnamedEntry) {
      throw new Error(
        `selenita: group member '${api}': bare cursor cannot be used in queryGroup factories — `
        + `replace cursor with cursor('name') to enable cross-member access via result.group.at('name').`,
      )
    }

    try {
      validateCursorEntries(bareEntries)
    }
    catch (err) {
      throw new Error(
        `selenita: group member '${api}': ${(err as Error).message.replace(/^selenita: /, '')}`,
      )
    }

    const offset = code.length
    const cursors = new Map<string, number>()
    for (const c of resolved.cursors) {
      cursors.set(c.name, offset + c.position)
    }

    memberData.push({ api, cursors })
    code += `${resolved.text}\n`
  }

  host.setVirtualFile(fileName, code)

  try {
    const diagnostics = collectDiagnostics(ls, fileName, code)

    // Compute all per-member results eagerly while the virtual file is alive.
    type MemberResults = Map<string, SingleCursorResult> // qualified key → result
    const memberResults = new Map<string, MemberResults>()
    const groupInlayHints = collectInlayHints(ls, fileName, code)

    for (const member of memberData) {
      const cursorResults = new Map<string, SingleCursorResult>()
      for (const [qualifiedName, position] of member.cursors) {
        cursorResults.set(qualifiedName, buildSingleCursorResult(ls, fileName, code, position, diagnostics))
      }
      memberResults.set(member.api, cursorResults)
    }

    const forMember = (apiName: string): QueryResult => {
      const cursorResults = memberResults.get(apiName)
      if (!cursorResults) {
        const names = groupValue.members.join(', ')
        throw new Error(`selenita: group member '${apiName}' not found — members: ${names}`)
      }
      if (cursorResults.size === 0) {
        throw new Error(`selenita: group member '${apiName}' has no cursors.`)
      }
      if (cursorResults.size === 1) {
        const [qualifiedName, single] = [...cursorResults.entries()][0]!
        const bareKey = qualifiedName.replace(`${apiName}.`, '')
        return {
          ...single,
          at: (cursorName: string) => {
            if (cursorName !== bareKey) {
              throw new Error(`selenita: cursor '${cursorName}' not found in '${apiName}' — the only cursor is '${bareKey}'.`)
            }
            return single
          },
        }
      }

      const at = (cursorName: string): SingleCursorResult => {
        const qualified = `${apiName}.${cursorName}`
        const result = cursorResults.get(qualified)
        if (!result) {
          const names = [...cursorResults.keys()].map(k => k.replace(`${apiName}.`, '')).join(', ')
          throw new Error(`selenita: cursor '${cursorName}' not found in '${apiName}' — available: ${names}`)
        }
        return result
      }

      return {
        at,
        completions: [],
        completionItems: [],
        completionItem: () => undefined,
        completionItemsOfKind: () => [],
        hover: null,
        signatureHelp: null,
        diagnostics,
        errors: diagnostics.filter(d => d.severity === 'error'),
        warnings: diagnostics.filter(d => d.severity === 'warning'),
        inlayHints: groupInlayHints,
      } satisfies QueryResult
    }

    const groupAt = (cursorName: string): GroupCursorResult => {
      const missingMembers = memberData.filter(m =>
        !memberResults.get(m.api)?.has(`${m.api}.${cursorName}`),
      )

      if (missingMembers.length === memberData.length) {
        // Cursor not found anywhere — surface available cursor names.
        const knownNames = new Set<string>()
        for (const m of memberData) {
          for (const key of (memberResults.get(m.api)?.keys() ?? [])) {
            knownNames.add(key.startsWith(`${m.api}.`) ? key.slice(m.api.length + 1) : key)
          }
        }
        throw new Error(
          `selenita: cursor '${cursorName}' not found in group — available cursors: ${[...knownNames].join(', ')}`,
        )
      }

      if (missingMembers.length > 0) {
        // Cursor is present in some members but not others — this is a factory bug.
        throw new Error(
          `selenita: cursor '${cursorName}' is missing from some group members: ${missingMembers.map(m => m.api).join(', ')}. Ensure the group factory uses cursor('${cursorName}') consistently for every member.`,
        )
      }

      const completions: Record<string, string[]> = {}
      for (const member of memberData) {
        const qualified = `${member.api}.${cursorName}`
        const result = memberResults.get(member.api)?.get(qualified)
        completions[member.api] = result?.completions ?? []
      }
      return buildGroupCursorResult(completions, groupValue.label)
    }

    return {
      for: forMember,
      group: { at: groupAt },
      diagnostics,
      errors: diagnostics.filter(d => d.severity === 'error'),
      warnings: diagnostics.filter(d => d.severity === 'warning'),
    }
  }
  finally {
    host.deleteVirtualFile(fileName)
  }
}

// ── Per-cursor result builder ────────────────────────────────────────────────

function buildSingleCursorResult(
  ls: ts.LanguageService,
  fileName: string,
  code: string,
  position: number,
  diagnostics: Diagnostic[],
  precomputedInlayHints?: InlayHint[],
): SingleCursorResult {
  let completionItems: CompletionItem[] = []
  try {
    const rawCompletions = ls.getCompletionsAtPosition(fileName, position, undefined)
    completionItems = rawCompletions?.entries.map(e => mapCompletionEntry(ls, fileName, code, position, e)) ?? []
  }
  catch {
    // Delegate to TS; never throw on bad positions
  }
  const completions = completionItems.map(c => c.name)

  const hover = collectHover(ls, fileName, position)
  const signatureHelp = collectSignatureHelp(ls, fileName, position)
  const inlayHints = precomputedInlayHints ?? collectInlayHints(ls, fileName, code)

  return {
    completions,
    completionItems,
    completionItem: (name: string) => completionItems.find(c => c.name === name),
    completionItemsOfKind: (kind: CompletionItemKind) => completionItems.filter(c => c.kind === kind),
    hover,
    signatureHelp,
    inlayHints,
    diagnostics,
    errors: diagnostics.filter(d => d.severity === 'error'),
    warnings: diagnostics.filter(d => d.severity === 'warning'),
  }
}

// ── Completion mapping ──────────────────────────────────────────────────────

function mapCompletionEntry(
  ls: ts.LanguageService,
  fileName: string,
  _code: string,
  position: number,
  entry: ts.CompletionEntry,
): CompletionItem {
  const kind = mapKind(entry.kind)
  const kindModifierSet = new Set(entry.kindModifiers?.split(',') ?? [])
  const isDeprecated = kindModifierSet.has('deprecated')
  const isOptional = kindModifierSet.has('optional')
  const isRecommended = (entry as ts.CompletionEntry & { isRecommended?: boolean }).isRecommended ?? false

  let type = ''
  let documentation = ''

  try {
    const details = ls.getCompletionEntryDetails(
      fileName,
      position,
      entry.name,
      {},
      undefined,
      undefined,
      undefined,
    )
    if (details) {
      type = ts.displayPartsToString(details.displayParts ?? [])
      documentation = ts.displayPartsToString(details.documentation ?? [])
    }
  }
  catch {
    // Details are best-effort; never fail a query over them
  }

  // TypeScript returns string literal completions with surrounding quotes in the
  // name field (e.g. "'red'" for type Color = 'red' | 'green'). Strip them so
  // completions always contain the plain value, matching the spec examples.
  const name = entry.name.replace(/^(['"])(.+)\1$/, '$2')

  return { name, kind, type, documentation, isDeprecated, isOptional, isRecommended }
}

function mapKind(kind: ts.ScriptElementKind): CompletionItemKind {
  const map: Partial<Record<ts.ScriptElementKind, CompletionItemKind>> = {
    [ts.ScriptElementKind.memberVariableElement]: 'property',
    [ts.ScriptElementKind.memberGetAccessorElement]: 'property',
    [ts.ScriptElementKind.memberSetAccessorElement]: 'property',
    [ts.ScriptElementKind.memberFunctionElement]: 'method',
    [ts.ScriptElementKind.variableElement]: 'variable',
    [ts.ScriptElementKind.letElement]: 'variable',
    [ts.ScriptElementKind.constElement]: 'variable',
    [ts.ScriptElementKind.localVariableElement]: 'variable',
    [ts.ScriptElementKind.keyword]: 'keyword',
    [ts.ScriptElementKind.classElement]: 'class',
    [ts.ScriptElementKind.localClassElement]: 'class',
    [ts.ScriptElementKind.interfaceElement]: 'interface',
    [ts.ScriptElementKind.typeElement]: 'type',
    [ts.ScriptElementKind.enumElement]: 'enum',
    [ts.ScriptElementKind.enumMemberElement]: 'enum',
    [ts.ScriptElementKind.moduleElement]: 'module',
    [ts.ScriptElementKind.externalModuleName]: 'module',
    [ts.ScriptElementKind.functionElement]: 'function',
    [ts.ScriptElementKind.localFunctionElement]: 'function',
    [ts.ScriptElementKind.constructorImplementationElement]: 'constructor',
  }
  return map[kind] ?? 'variable'
}

// ── Hover ───────────────────────────────────────────────────────────────────

function collectHover(ls: ts.LanguageService, fileName: string, position: number): string | null {
  try {
    const info = ls.getQuickInfoAtPosition(fileName, position)
    if (!info)
      return null
    const parts = [...(info.displayParts ?? []), ...(info.documentation ?? [])]
    const text = ts.displayPartsToString(parts)
    return text || null
  }
  catch {
    return null
  }
}

// ── Signature help ──────────────────────────────────────────────────────────

function collectSignatureHelp(ls: ts.LanguageService, fileName: string, position: number): SignatureHelp | null {
  try {
    const raw = ls.getSignatureHelpItems(fileName, position, undefined)
    if (!raw || raw.items.length === 0)
      return null

    return {
      activeSignature: raw.selectedItemIndex,
      activeParameter: raw.argumentIndex,
      signatures: raw.items.map(item => ({
        label: ts.displayPartsToString(item.prefixDisplayParts)
          + item.parameters.map(p => ts.displayPartsToString(p.displayParts)).join(ts.displayPartsToString(item.separatorDisplayParts))
          + ts.displayPartsToString(item.suffixDisplayParts),
        documentation: ts.displayPartsToString(item.documentation ?? []),
        parameters: item.parameters.map(p => ({
          label: ts.displayPartsToString(p.displayParts),
          documentation: ts.displayPartsToString(p.documentation ?? []),
        })),
      })),
    }
  }
  catch {
    return null
  }
}

// ── Inlay hints ─────────────────────────────────────────────────────────────

function collectInlayHints(ls: ts.LanguageService, fileName: string, code: string): InlayHint[] {
  const span: ts.TextSpan = { start: 0, length: code.length }
  const preferences: ts.UserPreferences = {
    includeInlayParameterNameHints: 'all',
    includeInlayParameterNameHintsWhenArgumentMatchesName: true,
    includeInlayFunctionParameterTypeHints: true,
    includeInlayVariableTypeHints: true,
    includeInlayPropertyDeclarationTypeHints: true,
    includeInlayFunctionLikeReturnTypeHints: true,
    includeInlayEnumMemberValueHints: true,
  }
  let raw: ts.InlayHint[]
  try {
    raw = ls.provideInlayHints(fileName, span, preferences)
  }
  catch {
    return []
  }

  return raw.map((hint) => {
    const pos = offsetToLineColumn(code, hint.position)
    const rawText = hint.text
    // InlayHint.text is `string | InlayHintDisplayPart[]` in TS API
    const text = typeof rawText === 'string'
      ? rawText
      : (rawText as Array<{ text: string }>).map(p => p.text).join('')
    return {
      text,
      kind: mapInlayHintKind(hint.kind),
      line: pos.line,
      column: pos.column,
    }
  })
}

function mapInlayHintKind(kind: ts.InlayHintKind): 'parameter' | 'type' | 'enum' {
  if (kind === ts.InlayHintKind.Parameter)
    return 'parameter'
  if (kind === ts.InlayHintKind.Enum)
    return 'enum'
  return 'type'
}

// ── Diagnostics ─────────────────────────────────────────────────────────────

function collectDiagnostics(ls: ts.LanguageService, fileName: string, code: string): Diagnostic[] {
  const raw = [
    ...ls.getSyntacticDiagnostics(fileName),
    ...ls.getSemanticDiagnostics(fileName),
    ...ls.getSuggestionDiagnostics(fileName),
  ]

  return raw.map((d) => {
    const pos = d.start !== undefined ? offsetToLineColumn(code, d.start) : { line: 1, column: 1 }
    return {
      message: ts.flattenDiagnosticMessageText(d.messageText, '\n'),
      code: d.code,
      severity: mapSeverity(d.category),
      line: pos.line,
      column: pos.column,
    }
  })
}

function mapSeverity(category: ts.DiagnosticCategory): 'error' | 'warning' | 'suggestion' {
  if (category === ts.DiagnosticCategory.Error)
    return 'error'
  if (category === ts.DiagnosticCategory.Warning)
    return 'warning'
  return 'suggestion'
}

// ── Group parity ─────────────────────────────────────────────────────────────

function buildGroupCursorResult(completions: Record<string, string[]>, label: string | null): GroupCursorResult {
  const sets = Object.entries(completions)
  if (sets.length === 0)
    return { completions, hasParity: true, divergence: null, label }

  // Sort each member's completions for comparison
  const sorted = sets.map(([api, items]) => ({ api, items: [...items].sort() }))

  // Find majority baseline — most common set (ties: first listed wins)
  const canonicals = sorted.map(s => JSON.stringify(s.items))
  const freq = new Map<string, number>()
  for (const c of canonicals) freq.set(c, (freq.get(c) ?? 0) + 1)
  const maxFreq = Math.max(...freq.values())
  const baselineIndex = canonicals.findIndex(c => (freq.get(c) ?? 0) === maxFreq)
  const baseline = sorted[baselineIndex]!.items

  const hasParity = sorted.every(s => JSON.stringify(s.items) === JSON.stringify(baseline))

  if (hasParity)
    return { completions, hasParity: true, divergence: null, label }

  const baselineSet = new Set(baseline)
  const members: DivergenceReport['members'] = {}

  for (const { api, items } of sorted) {
    const memberSet = new Set(items)
    members[api] = {
      added: items.filter(x => !baselineSet.has(x)),
      removed: baseline.filter(x => !memberSet.has(x)),
    }
  }

  return {
    completions,
    hasParity: false,
    divergence: { baseline, members },
    label,
  }
}

// ── Offset → line/column ────────────────────────────────────────────────────

function offsetToLineColumn(code: string, offset: number): { line: number, column: number } {
  let line = 1
  let column = 1
  for (let i = 0; i < offset && i < code.length; i++) {
    if (code[i] === '\n') {
      line++
      column = 1
    }
    else {
      column++
    }
  }
  return { line, column }
}
