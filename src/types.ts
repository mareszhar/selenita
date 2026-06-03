// ── Public result shapes ────────────────────────────────────────────────────

export type CompletionItemKind
  = | 'property'
    | 'method'
    | 'variable'
    | 'keyword'
    | 'class'
    | 'interface'
    | 'type'
    | 'enum'
    | 'module'
    | 'function'
    | 'constructor'

export interface CompletionItem {
  name: string
  kind: CompletionItemKind
  /** Full display string, e.g. `"(property) Fruit.name: string"` */
  type: string
  /** JSDoc or other attached documentation; empty string if none */
  documentation: string
  isDeprecated: boolean
  isOptional: boolean
  /** True when the TS language service marks the entry as recommended */
  isRecommended: boolean
}

export interface Diagnostic {
  message: string
  /** TypeScript error code, e.g. `2339` */
  code: number
  severity: 'error' | 'warning' | 'suggestion'
  /** 1-indexed */
  line: number
  /** 1-indexed */
  column: number
}

export interface SignatureHelp {
  signatures: Array<{
    /** Full signature string, e.g. `"registerFruit(fruit: Fruit): void"` */
    label: string
    documentation: string
    parameters: Array<{
      label: string
      documentation: string
    }>
  }>
  /** Zero-indexed index of the active overload */
  activeSignature: number
  /** Zero-indexed index of the active parameter */
  activeParameter: number
}

export interface InlayHint {
  /** Display text, e.g. `"fruit:"` or `": Fruit"` */
  text: string
  kind: 'parameter' | 'type' | 'enum'
  /** 1-indexed */
  line: number
  /** 1-indexed */
  column: number
}

// ── Result interfaces ───────────────────────────────────────────────────────

export interface SingleCursorResult {
  completions: string[]
  completionItems: CompletionItem[]
  completionItem: (name: string) => CompletionItem | undefined
  completionItemsOfKind: (kind: CompletionItemKind) => CompletionItem[]

  hover: string | null
  signatureHelp: SignatureHelp | null
  inlayHints: InlayHint[]

  diagnostics: Diagnostic[]
  errors: Diagnostic[]
  warnings: Diagnostic[]
}

export interface CheckResult {
  diagnostics: Diagnostic[]
  errors: Diagnostic[]
  warnings: Diagnostic[]
  inlayHints: InlayHint[]
}

// ── Group result shapes ─────────────────────────────────────────────────────

export interface DivergenceReport {
  /** The completion set shared by the most group members (ties: first-listed wins) */
  baseline: string[]
  members: Record<string, {
    added: string[]
    removed: string[]
  }>
}

export interface GroupCursorResult {
  /** Completions indexed by API name */
  completions: Record<string, string[]>
  /** True if all group members have identical completion sets (order-insensitive) */
  hasParity: boolean
  /** Null when hasParity is true */
  divergence: DivergenceReport | null
  /** Label from the named `group()` call, or null for anonymous groups */
  label: string | null
}

export interface GroupAnalysis {
  at: (cursorName: string) => GroupCursorResult
}

/**
 * The result of a `project.query` call.
 *
 * All `SingleCursorResult` fields (`completions`, `hover`, etc.) are always
 * present and accessible directly — no type casts needed. For single-cursor
 * queries they carry the cursor's data; for multi-cursor queries they are
 * empty/null and you should use `.at(cursorName)` instead.
 *
 * `.at()` is always present for named-cursor and multi-cursor queries. For
 * unnamed bare-cursor queries it throws a helpful error pointing you to direct
 * property access.
 */
export interface QueryResult extends SingleCursorResult {
  at: (cursorName: string) => SingleCursorResult
}

export interface GroupQueryResult {
  for: (apiName: string) => QueryResult
  group: GroupAnalysis
  diagnostics: Diagnostic[]
  errors: Diagnostic[]
  warnings: Diagnostic[]
}
