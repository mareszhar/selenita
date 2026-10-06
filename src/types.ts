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
  /** Observe at a named cursor or the start of a mark. */
  readonly at: (name: Cursors | Marks) => Observations
  /** Observe the same named marker across scopes, optionally requiring every listed scope. */
  readonly atEach: <Name extends ScopedLast<Cursors | Marks>>(name: Name, scopes?: readonly ScopeOf<Cursors | Marks, Name>[]) => Readonly<Record<string, Observations>>
}
export interface CheckResult<Names extends string = string> {
  /** Locate the fixture text named by a cursor or mark. */
  readonly rangeOf: (name: Names) => Range
  /** Error-severity diagnostics in the fixture files. */
  readonly errors: readonly Diagnostic[]
  /** All diagnostics in the fixture files, including suggestions. */
  readonly diagnostics: readonly Diagnostic[]
  /** Inline guidance for written code in the fixture files. */
  readonly inlayHints: readonly InlayHint[]
  /** The fixture source, keyed by file name. */
  readonly files: Readonly<Record<string, string>>
  /** Run a synchronous inspection with this fixture active. */
  readonly inspect: <Value>(runInspection: (context: InspectionContext) => Value) => Value
}
export interface InspectionContext {
  /** The language service with the inspected fixture active. */
  service: ts.LanguageService
  /** The TypeScript backend that produces these observations. */
  typescript: typeof ts
  /** Resolve a file name from the project root. */
  resolvePath: (file: string) => string
}
export interface Observations {
  /** The names suggested at this marker, without computing entry details. */
  readonly completionNames: readonly string[]
  /** The suggestions at this marker, with details computed when read. */
  readonly completions: readonly Completion[]
  /** Find a suggestion by name and optionally its import source. */
  readonly findCompletion: (selector: string | { name: string, source?: string }) => Completion | undefined
  /** The tooltip at this marker, or null when there is none. */
  readonly hover: Hover | null
  /** Argument guidance at this marker, or null outside a call. */
  readonly signatureHelp: SignatureHelp | null
  /** Whether this symbol can be renamed and the uses that would follow. */
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
  /** Observe editor behavior at the cursors in a fixture. */
  query: QueryTag
  /** Observe diagnostics and inlay hints in a fixture. */
  check: CheckTag
  /** Derive a project with additional configuration layers. */
  extend: (...configs: ProjectConfig[]) => Project
  /** Build the initial program before reading observations. */
  warmUp: () => void
  /** Release this project and its derived projects. */
  dispose: () => void
  /** Release this project when its using scope ends. */
  [Symbol.dispose]: () => void
}
export interface Point {
  /** The one-based line in the source. */
  readonly line: number
  /** The one-based column in the source. */
  readonly column: number
  /** The zero-based UTF-16 offset in the source. */
  readonly offset: number
}
export interface Range {
  /** The source file, relative to the project root. */
  readonly file: string
  /** Where this text begins. */
  readonly start: Point
  /** Where this text ends, exclusive. */
  readonly end: Point
  /** The source text covered by this range. */
  readonly text: string
}
export interface DocTag {
  /** The documentation tag name, without @. */
  readonly name: string
  /** The prose attached to this documentation tag. */
  readonly text: string
}
export type CompletionKind = ts.ScriptElementKind | (string & {})
export interface Completion {
  /** The suggested name, with string-literal quotes removed. */
  readonly name: string
  /** The kind of symbol the editor suggests. */
  readonly kind: CompletionKind
  /** Whether the editor marks this suggestion as deprecated. */
  readonly isDeprecated: boolean
  /** Whether this member is optional. */
  readonly isOptional: boolean
  /** Whether the editor recommends this suggestion. */
  readonly isRecommended: boolean
  /** The import source for this suggestion, or null for a local symbol. */
  readonly source: string | null
  /** The text accepting this suggestion inserts, or null when the name is used. */
  readonly insertText: string | null
  /** The source accepting this suggestion replaces, or null for insertion at the caret. */
  readonly replacementRange: Range | null
  /** The native text the editor uses to sort this suggestion. */
  readonly sortText: string
  /** The signature or type shown in this suggestion's details. */
  readonly displayText: string
  /** The prose explaining this suggestion. */
  readonly documentation: string
  /** The documentation tags attached to this suggestion. */
  readonly tags: readonly DocTag[]
  /** The additional edits offered when accepting this suggestion. */
  readonly codeActions: readonly CodeAction[]
}
export interface Hover {
  /** The symbol's signature or type shown in the tooltip. */
  readonly displayText: string
  /** The prose explaining the hovered symbol. */
  readonly documentation: string
  /** The hovered symbol's documentation tags. */
  readonly tags: readonly DocTag[]
  /** The whole tooltip: display text, prose, and tags. */
  readonly text: string
  /** The source the tooltip describes. */
  readonly range: Range
}
export interface Parameter {
  /** The parameter's name. */
  readonly name: string
  /** The parameter's rendered declaration in signature help. */
  readonly label: string
  /** The prose explaining this parameter. */
  readonly documentation: string
}
export interface Signature {
  /** The whole rendered call signature. */
  readonly label: string
  /** The prose explaining this call signature. */
  readonly documentation: string
  /** The documentation tags attached to this signature. */
  readonly tags: readonly DocTag[]
  /** The parameters in declaration order. */
  readonly parameters: readonly Parameter[]
}
export interface SignatureHelp {
  /** The call signatures offered at this marker. */
  readonly signatures: readonly Signature[]
  /** The signature selected for this call. */
  readonly activeSignature: Signature
  /** The parameter being entered, or null beyond the signature's parameters. */
  readonly activeParameter: Parameter | null
  /** The zero-based index of the selected signature. */
  readonly activeSignatureIndex: number
  /** The zero-based index of the argument being entered. */
  readonly activeParameterIndex: number
}
export interface InlayHint {
  /** The inline guidance displayed by the editor. */
  readonly text: string
  /** Whether this hint describes a parameter, type, or enum value. */
  readonly kind: 'parameter' | 'type' | 'enum'
  /** The insertion point where the editor displays this hint. */
  readonly range: Range
}
export interface Rename {
  /** Whether the editor permits renaming this symbol. */
  readonly canRename: boolean
  /** Why renaming was refused, or null when allowed. */
  readonly reason: string | null
  /** The uses that would follow a rename, sorted by file and offset. */
  readonly locations: readonly RenameLocation[]
}
export interface RenameLocation extends Range {
  /** The text to insert before the new name to preserve meaning. */
  readonly prefixText?: string
  /** The text to insert after the new name to preserve meaning. */
  readonly suffixText?: string
}
export interface RelatedInformation {
  /** The editor's explanation of this related location. */
  readonly message: string
  /** The related source, or null without a source location. */
  readonly range: Range | null
}
export interface Diagnostic {
  /** The diagnostic's native numeric identifier. */
  readonly code: number
  /** How the editor classifies this diagnostic. */
  readonly severity: 'error' | 'warning' | 'suggestion' | 'message'
  /** The editor's explanation of the problem. */
  readonly message: string
  /** The underlined source, or null without a source location. */
  readonly range: Range | null
  /** Other messages and locations explaining this diagnostic. */
  readonly relatedInformation: readonly RelatedInformation[]
  /** The code actions offered to fix this diagnostic, computed when read. */
  readonly codeFixes: readonly CodeAction[]
}
export interface TextEdit {
  /** The source this edit replaces; an empty range inserts text. */
  readonly range: Range
  /** The replacement source text. */
  readonly newText: string
}
export interface CodeAction {
  /** The editor's description of this action. */
  readonly description: string
  /** The source edits offered by this action. */
  readonly edits: readonly TextEdit[]
  /** The fixture files with this action's edits applied, ready to check again. */
  readonly fixedFiles: Readonly<Record<string, string>>
}
export interface CompletionComparison {
  /** Whether every member suggests the same set of names. */
  readonly hasParity: boolean
  /** The most common completion set used to explain differences. */
  readonly baseline: readonly string[]
  /** The names each divergent member adds or lacks relative to the baseline. */
  readonly differences: Readonly<Record<string, { readonly added: readonly string[], readonly removed: readonly string[] }>>
}
