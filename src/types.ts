import type { Cursor, Mark, Snippet } from './markers'
import type ts from './typescript'

export type Interpolation = string | Cursor | Mark | Snippet | readonly Interpolation[]
export type Files = Readonly<Record<string, string | Snippet>>
type CursorOf<Value> = Interpolation extends Value ? string : Value extends Cursor<infer Name> ? Name
  : Value extends Mark<string, infer Names, string> ? Names
    : Value extends Snippet<infer Names, string> ? Names
      : Value extends readonly (infer Element)[] ? CursorOf<Element> : never
type MarkOf<Value> = Interpolation extends Value ? string : Value extends Mark<infer Name, string, infer Names> ? Name | Names
  : Value extends Snippet<string, infer Names> ? Names
    : Value extends readonly (infer Element)[] ? MarkOf<Element> : never
export type CursorsOf<Value> = Value extends readonly unknown[] ? CursorOf<Value[number]>
  : Value extends Files ? CursorOf<Value[keyof Value]> : never
export type MarksOf<Value> = Value extends readonly unknown[] ? MarkOf<Value[number]>
  : Value extends Files ? MarkOf<Value[keyof Value]> : never
type LastSegment<Name extends string> = Name extends `${string}.${infer Rest}` ? LastSegment<Rest> : Name
type ScopedLast<Name extends string> = string extends Name ? string : Name extends `${string}.${infer Rest}` ? LastSegment<Rest> : never
type ScopeOf<Name extends string, Last extends string> = string extends Name ? string : Name extends `${infer Scope}.${Last}` ? Scope : never

export interface QueryTag {
  <const Values extends readonly Interpolation[]>(strings: TemplateStringsArray, ...values: Values): QueryResult<CursorsOf<Values>, MarksOf<Values>>
  <const SourceFiles extends Files>(files: SourceFiles): QueryResult<CursorsOf<SourceFiles>, MarksOf<SourceFiles>>
}
export interface CheckTag {
  <const Values extends readonly Interpolation[]>(strings: TemplateStringsArray, ...values: Values): CheckResult<CursorsOf<Values> | MarksOf<Values>>
  <const SourceFiles extends Files>(files: SourceFiles): CheckResult<CursorsOf<SourceFiles> | MarksOf<SourceFiles>>
}
export interface QueryResult<Cursors extends string = string, Marks extends string = string> extends Observations, CheckResult<Cursors | Marks> {
  readonly at: (name: Cursors | Marks) => Observations
  readonly atEach: <Name extends ScopedLast<Cursors | Marks>>(name: Name, scopes?: readonly ScopeOf<Cursors | Marks, Name>[]) => Readonly<Record<string, Observations>>
}
export interface CheckResult<Names extends string = string> {
  readonly rangeOf: (name: Names) => Range
  readonly errors: readonly Diagnostic[]
  readonly diagnostics: readonly Diagnostic[]
  readonly inlayHints: readonly InlayHint[]
  readonly files: Readonly<Record<string, string>>
  readonly inspect: <Value>(runInspection: (context: InspectionContext) => Value) => Value
}
export interface InspectionContext {
  service: ts.LanguageService
  typescript: typeof ts
  resolvePath: (file: string) => string
}
export interface Observations {
  readonly completionNames: readonly string[]
  readonly completions: readonly Completion[]
  readonly findCompletion: (selector: string | { name: string, source?: string }) => Completion | undefined
  readonly hover: Hover | null
  readonly signatureHelp: SignatureHelp | null
  readonly rename: Rename
}
export type JsonValue = string | number | boolean | null | readonly JsonValue[] | { [key: string]: JsonValue }
export type CompilerOptionsJson = { [Key in keyof ts.CompilerOptions]?: JsonValue }
export type Plugin = ts.server.PluginModuleFactory
export type PluginEntry = Plugin | readonly [Plugin, Record<string, unknown>]
export interface ProjectConfig {
  /** The tsconfig path, relative to the working directory; false for in-memory defaults. */
  tsconfig?: string | false
  /** Compiler settings in tsconfig.json spelling, applied over the tsconfig. */
  compilerOptions?: CompilerOptionsJson
  /** The editor's preferences, applied over editor-like defaults. */
  preferences?: ts.UserPreferences
  /** Virtual files available for this project's lifetime; root-relative keys. */
  files?: Record<string, string>
  /** Import specifiers mapped to root-relative paths, including * wildcards. */
  aliases?: Record<string, string>
  /** Language-service plugin factories, applied in order, optionally paired with config. */
  plugins?: readonly PluginEntry[]
}
export interface Project {
  query: QueryTag
  check: CheckTag
  extend: (...configs: ProjectConfig[]) => Project
  warmUp: () => void
  dispose: () => void
  [Symbol.dispose]: () => void
}
export interface Point { readonly line: number, readonly column: number, readonly offset: number }
export interface Range { readonly file: string, readonly start: Point, readonly end: Point, readonly text: string }
export interface DocTag { readonly name: string, readonly text: string }
export type CompletionKind = ts.ScriptElementKind | (string & {})
export interface Completion {
  readonly name: string
  readonly kind: CompletionKind
  readonly isDeprecated: boolean
  readonly isOptional: boolean
  readonly isRecommended: boolean
  readonly source: string | null
  readonly insertText: string | null
  readonly replacementRange: Range | null
  readonly sortText: string
  readonly displayText: string
  readonly documentation: string
  readonly tags: readonly DocTag[]
  readonly codeActions: readonly CodeAction[]
}
export interface Hover { readonly displayText: string, readonly documentation: string, readonly tags: readonly DocTag[], readonly text: string, readonly range: Range }
export interface Parameter { readonly name: string, readonly label: string, readonly documentation: string }
export interface Signature { readonly label: string, readonly documentation: string, readonly tags: readonly DocTag[], readonly parameters: readonly Parameter[] }
export interface SignatureHelp {
  readonly signatures: readonly Signature[]
  readonly activeSignature: Signature
  readonly activeParameter: Parameter | null
  readonly activeSignatureIndex: number
  readonly activeParameterIndex: number
}
export interface InlayHint { readonly text: string, readonly kind: 'parameter' | 'type' | 'enum', readonly range: Range }
export interface Rename { readonly canRename: boolean, readonly reason: string | null, readonly locations: readonly RenameLocation[] }
export interface RenameLocation extends Range { readonly prefixText?: string, readonly suffixText?: string }
export interface RelatedInformation { readonly message: string, readonly range: Range | null }
export interface Diagnostic {
  readonly code: number
  readonly severity: 'error' | 'warning' | 'suggestion' | 'message'
  readonly message: string
  readonly range: Range | null
  readonly relatedInformation: readonly RelatedInformation[]
  readonly codeFixes: readonly CodeFix[]
}
export interface TextEdit { readonly range: Range, readonly newText: string }
export interface CodeAction { readonly description: string, readonly edits: readonly TextEdit[] }
export interface CodeFix extends CodeAction { readonly fixedFiles: Readonly<Record<string, string>> }
export interface CompletionComparison {
  readonly hasParity: boolean
  readonly baseline: readonly string[]
  readonly differences: Readonly<Record<string, { readonly added: readonly string[], readonly removed: readonly string[] }>>
}
