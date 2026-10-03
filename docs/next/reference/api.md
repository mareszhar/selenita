# API reference

The exact public contract of `@mszr/selenita`. Guides explain how to use it; this page says precisely what it does. Matchers have [their own reference](./matchers.md).

## Contents

- [Entry points](#entry-points)
- [Projects](#projects): [`createProject`](#createproject), [`defineProject`](#defineproject), [`ProjectConfig`](#projectconfig), [`Project`](#project), [plugins](#plugin)
- [Fixtures](#fixtures): [`cursor`](#cursor), [`mark`](#mark), [`snippet`](#snippet), [interpolation](#interpolation), [files](#fixture-files)
- [Results](#results): [`QueryResult`](#queryresult), [`CheckResult`](#checkresult), [`Observations`](#observations), [laziness](#laziness-and-activation)
- [Observation types](#observation-types): [`CompletionItem`](#completionitem), [`Hover`](#hover), [`SignatureHelp`](#signaturehelp), [`Rename`](#rename), [`Diagnostic`](#diagnostic), [`CodeFix`](#codefix), [`Range`](#range)
- [Errors](#errors)

## Entry points

| Import | Contains | Use it |
| --- | --- | --- |
| `@mszr/selenita` | `createProject`, `cursor`, `mark`, `snippet`, `SelenitaError`, all types | Outside Vitest: scripts, benchmarks, other runners |
| `@mszr/selenita/vitest` | Everything above, plus `defineProject`; installs the [matchers](./matchers.md) and their types | In Vitest test files and test-support modules |

Both are ESM. Node 22.12+ can `require()` them. The Vitest entry requires Vitest 5.

## Projects

### `createProject`

```ts
function createProject(config?: ProjectConfig): Project
```

Creates a project the caller owns. Validates `config` immediately; builds the TypeScript program on first use or on `warmup()`. Release it with `dispose()` or `using`.

### `defineProject`

```ts
function defineProject(config?: ProjectConfig): Project // from '@mszr/selenita/vitest'
```

`createProject` plus Vitest lifecycle: registers `beforeAll(() => project.warmup())` and `afterAll(() => project.dispose())` in the scope where it is called. Throws when called while a test is running; use `createProject` with `using` there.

### `ProjectConfig`

```ts
interface ProjectConfig {
  /** Path to a tsconfig, relative to the working directory. Default: nearest tsconfig.json walking up from the working directory. `false`: in-memory defaults. */
  tsconfig?: string | false
  /** Compiler options in tsconfig.json spelling, applied over the tsconfig. */
  compilerOptions?: CompilerOptionsJson
  /** Virtual files for the project's lifetime. Keys resolve from the project root. */
  files?: Record<string, string>
  /** Import specifiers mapped to paths (tsconfig `paths` semantics; `*` wildcards). Values resolve from the project root. */
  aliases?: Record<string, string>
  /** Language-service plugins, applied in order: a factory, or a factory with its config. */
  plugins?: readonly (Plugin | readonly [Plugin, Record<string, unknown>])[]
}

type CompilerOptionsJson = { [K in keyof ts.CompilerOptions]?: JsonValue }
```

| Rule | Behavior |
| --- | --- |
| Unknown config key | Throws, listing valid keys. |
| `tsconfig` path missing or unreadable | Throws with the resolved path. |
| tsconfig with no inputs (TS18003) | Accepted — fixtures supply the inputs. Other tsconfig errors throw. |
| Invalid `compilerOptions` value | Throws with TypeScript's message for that option. |
| Project root | The tsconfig's directory; the working directory when `tsconfig` is `false`. |
| `tsconfig: false` defaults | `strict`, `target: ES2022`, `module: ESNext`, `moduleResolution: Bundler`, `lib: ['ES2022']`, `skipLibCheck`. |
| Precedence | tsconfig → `compilerOptions` → `aliases` (merged into `paths`, values made absolute). |

### `Project`

```ts
interface Project {
  query: QueryTag // see Fixtures
  check: CheckTag
  warmup: () => void // build the program now
  dispose: () => void // idempotent
  [Symbol.dispose]: () => void // same as dispose()
}
```

- One project owns one TypeScript language service. Projects never share semantic state; projects in the same process share parsed source files through one document registry.
- `query` and `check` throw on a disposed project.
- Configuration is fixed at creation. A different configuration is a different project.

### Plugin

```ts
type Plugin = (modules: { typescript: typeof ts }) => {
  create: (info: PluginCreateInfo) => ts.LanguageService
}

interface PluginCreateInfo {
  languageService: ts.LanguageService
  languageServiceHost: ts.LanguageServiceHost
  config: Record<string, unknown> // the entry's config, or {}
  project: {
    getCurrentDirectory: () => string
    getCompilerOptions: () => ts.CompilerOptions
    projectService: { logger: { info: (message: string) => void, msg: (message: string) => void, loggingEnabled: () => boolean } }
  }
}
```

This is the shape of a tsserver plugin module, so a real plugin's factory is passed as-is; the config is what tsserver would pass from the plugin's tsconfig entry. Plugins are created once per project, in order, each wrapping the previous service. Every observation uses the final service. A plugin that throws during `create` fails project initialization with the plugin's error as `cause`.

A plugin sees selenita's virtual files through the service and its host. A plugin that reads the file system directly (with `node:fs`) sees the disk, not virtual files.

## Fixtures

```ts
interface QueryTag {
  <const V extends readonly Interpolation[]>(strings: TemplateStringsArray, ...values: V): QueryResult<CursorsOf<V>, MarksOf<V>>
  <const F extends Files>(files: F): QueryResult<CursorsOf<F>, MarksOf<F>>
}
interface CheckTag {
  <const V extends readonly Interpolation[]>(strings: TemplateStringsArray, ...values: V): CheckResult<MarksOf<V>>
  <const F extends Files>(files: F): CheckResult<MarksOf<F>>
}

type Files = Readonly<Record<string, string | Snippet>>
type Interpolation = string | Cursor | Mark | Snippet | readonly Interpolation[]
```

Marker names are inferred from the interpolated values, so `at`, `range`, and `across` autocomplete them and reject unknown literals at compile time. Names built from runtime strings widen to `string`.

### `cursor`

```ts
const cursor: Cursor & (<const N extends string>(name: N) => Cursor<N>)
```

`cursor` is a bare cursor; `cursor('name')` is a named one. A cursor is zero-width: it occupies no fixture text.

### `mark`

```ts
function mark<const N extends string>(name: N): <const V extends readonly Interpolation[]>(strings: TemplateStringsArray, ...values: V) => Mark<N, CursorsOf<V>, MarksOf<V>>
```

``mark('name')`text` `` contributes `text` to the fixture and records its range. The tag accepts the same interpolations as a fixture, so a mark may contain cursors, snippets, and other marks.

### `snippet`

```ts
function snippet<const V extends readonly Interpolation[]>(strings: TemplateStringsArray, ...values: V): Snippet<CursorsOf<V>, MarksOf<V>>

interface Snippet<C extends string, M extends string> {
  /** The same snippet with every marker name prefixed by `scope.` */
  for: <const S extends string>(scope: S) => Snippet<`${S}.${C}`, `${S}.${M}`>
}
```

Snippets are immutable and inert. `.for()` returns a new snippet; scopes compose outside-in.

### Interpolation

| Value | Contributes |
| --- | --- |
| `string` | its text |
| `cursor`, `cursor(name)` | a cursor at that point |
| ``mark(name)`…` `` | its text, plus a mark over it |
| `snippet` | its text and markers (names prefixed by any `.for()` scopes) |
| array | each element in order, with no separator |
| anything else | throws `SelenitaError` naming the value's type |

| Marker rule | On violation |
| --- | --- |
| Names are one segment: non-empty, no `.`, no whitespace | throws at the `cursor()`/`mark()` call |
| Names are unique across the whole fixture | throws, naming the duplicate; hint: `.for(scope)` |
| A bare cursor is the fixture's only cursor | throws; hint: name every cursor |
| `check` fixtures contain no cursors | throws; hint: `mark` or `query` |
| `query` fixtures contain at least one cursor or mark | throws; hint: `check` |

### Fixture files

- **Template form**: one file, `__selenita__.ts`, in the project root.
- **Record form**: one file per key. Relative keys resolve from the project root; absolute keys are used as-is. The extension selects the script kind (`.ts`, `.tsx`, `.mts`, `.cts`, `.d.ts`, `.js`, `.jsx`, …).
- A fixture file whose path matches a real or project file replaces it for the duration of that query.
- Fixture text is the exact concatenation of the template — no dedent, no trimming.

## Results

### `QueryResult`

```ts
interface QueryResult<C extends string, M extends string> extends Observations {
  at: (name: C | M) => Observations
  range: (name: C | M) => Range
  across: (name: LastSegment<C>) => Record<string, Observations>
  readonly errors: readonly Diagnostic[]
  readonly diagnostics: readonly Diagnostic[]
  readonly files: Readonly<Record<string, string>>
  raw: <T>(fn: (context: RawContext) => T) => T
}
```

| Member | Semantics |
| --- | --- |
| `Observations` fields on the result itself | The fixture's only cursor. With zero or several cursors, reading one throws, listing the cursor names and pointing to `at()`. |
| `at(name)` | Observations at a cursor, or at the start of a mark. Unknown name throws, listing names. A bare cursor has no name: `at()` throws with a hint to read the result directly. |
| `range(name)` | The marker's range. Cursors have empty ranges (`start` equals `end`, `text` is `''`). |
| `across(name)` | Every cursor whose name is `<scope>.<name>`, keyed by `<scope>` (everything before the final segment). Throws when none exists, listing cursor names. |
| `errors` | Diagnostics with severity `error`, across all fixture files. |
| `diagnostics` | All diagnostics across all fixture files: syntactic, semantic, then suggestion; within each, by file then position. |
| `files` | The flattened source of each fixture file, keyed as written (template form: `__selenita__.ts`). |
| `raw(fn)` | Activates this result's fixture, then calls `fn` with raw TypeScript access. |

```ts
interface RawContext {
  service: ts.LanguageService // the project's service, plugins applied
  typescript: typeof ts // the backend module
  path: (file: string) => string // fixture or project-relative path → absolute file name
}
```

### `CheckResult`

```ts
interface CheckResult<M extends string> {
  range: (name: M) => Range
  readonly errors: readonly Diagnostic[]
  readonly diagnostics: readonly Diagnostic[]
  readonly files: Readonly<Record<string, string>>
  raw: <T>(fn: (context: RawContext) => T) => T
}
```

Same semantics as the matching `QueryResult` members.

### `Observations`

```ts
interface Observations {
  readonly completions: readonly string[]
  completionItem: (name: string) => CompletionItem | undefined
  readonly completionItems: readonly CompletionItem[]
  readonly hover: Hover | null
  readonly signatureHelp: SignatureHelp | null
  readonly rename: Rename
}
```

| Field | TypeScript request | Empty when |
| --- | --- | --- |
| `completions` | `getCompletionsAtPosition` | `[]` when TypeScript offers none |
| `completionItem(name)` | details for the first entry with that name | `undefined` when not offered |
| `completionItems` | details for every entry, in TypeScript's order | `[]` |
| `hover` | `getQuickInfoAtPosition` | `null` when TypeScript has no quick info |
| `signatureHelp` | `getSignatureHelpItems` | `null` outside a call's arguments |
| `rename` | `getRenameInfo`, then `findRenameLocations` | `{ canRename: false, … }` |

`completions` lists names in TypeScript's order, with quotes removed from string-literal entries (`'asc'` → `asc`). Duplicates are kept. Detail requests forward each entry's `source` and `data`, so auto-import and plugin entries resolve their own details.

### Laziness and activation

Results are plain objects whose observations are computed on first read and then kept. Data fields are enumerable, so `toEqual` and snapshots see them (reading them computes them); methods are not enumerable.

A project shows the editor one fixture at a time. Reading an observation activates its result's fixture first, which is a no-op when it is already active and otherwise swaps it back in. Consequences:

- A result always describes its own fixture, even when read after later queries.
- Module augmentations and globals in one fixture never affect another.
- Reading the first observation of a result after its project is disposed throws `SelenitaError` naming the observation; values already read remain.

All returned data is deeply frozen.

## Observation types

### `CompletionItem`

```ts
interface CompletionItem {
  name: string // as in `completions`
  kind: CompletionKind // TypeScript's ScriptElementKind, e.g. 'property', 'method', 'const'
  display: string // e.g. '(property) QueryOptions.table: string'
  documentation: string // '' when none
  tags: readonly DocTag[]
  deprecated: boolean
  optional: boolean
}

type CompletionKind = 'property' | 'method' | 'function' | 'const' | 'let' | 'var' | 'class' | 'interface' | 'type' | 'enum' | 'enum member' | 'module' | 'keyword' | 'alias' | 'parameter' | 'string' | (string & {})
interface DocTag { name: string, text: string }
```

`display` is TypeScript's display text, unmodified. It is presentation, not type identity: assert it with `toBe`, `toContain`, or a snapshot, choosing the strength your promise needs.

### `Hover`

```ts
interface Hover {
  display: string // the code-block part: 'const fruit: Fruit'
  documentation: string // the prose part; '' when none
  tags: readonly DocTag[]
  text: string // display, then documentation, then tags, separated by blank lines
  range: Range // the text the hover describes
}
```

`text` renders tags as `@name text`, one per line, in TypeScript's order.

### `SignatureHelp`

```ts
interface SignatureHelp {
  signatures: readonly Signature[] // every overload
  signature: Signature // the active overload
  parameter: Parameter | null // the active parameter of the active overload
  activeSignature: number // zero-based
  activeParameter: number // zero-based argument index
}
interface Signature { label: string, documentation: string, tags: readonly DocTag[], parameters: readonly Parameter[] }
interface Parameter { name: string, label: string, documentation: string }
```

`parameter` is `null` when the argument index has no matching parameter (for example, past the last non-rest parameter).

### `Rename`

```ts
interface Rename {
  canRename: boolean
  reason: string | null // TypeScript's message when canRename is false
  locations: readonly RenameLocation[] // [] when canRename is false
}
interface RenameLocation extends Range {
  prefix?: string // present only when TypeScript supplies non-empty text
  suffix?: string
}
```

Locations come from `findRenameLocations` with strings and comments excluded and prefix/suffix text enabled, sorted by `file`, then `start.offset`. They include project files outside the fixture when the symbol reaches them.

### `Diagnostic`

```ts
interface Diagnostic {
  code: number
  severity: 'error' | 'warning' | 'suggestion' | 'message'
  message: string // the full message chain, flattened as TypeScript prints it
  range: Range | null // null for diagnostics without a file position
  related: readonly RelatedInformation[]
  readonly fixes: readonly CodeFix[] // lazy
}
interface RelatedInformation { message: string, range: Range | null }
```

### `CodeFix`

```ts
interface CodeFix {
  description: string
  edits: readonly TextEdit[]
  /** The fixture's files with these edits applied, plus any other file the edits change. */
  apply: () => Readonly<Record<string, string>>
}
interface TextEdit { range: Range, newText: string }
```

`fixes` requests `getCodeFixesAtPosition` for the diagnostic's range and code. `apply()` applies edits per file from the end backwards; overlapping edits throw. Its result is a valid record-form fixture, so `project.check(fix.apply())` re-checks the fixed code.

### `Range`

```ts
interface Range {
  file: string // relative to the project root, '/'-separated; absolute when outside the root
  start: Point
  end: Point // exclusive
  text: string // the source text between start and end
}
interface Point {
  line: number // 1-based
  column: number // 1-based, in UTF-16 code units
  offset: number // 0-based, in UTF-16 code units
}
```

Ranges are plain data: compare them with `toEqual`. Two ranges with equal text in different places are different ranges.

## Errors

selenita throws `SelenitaError` (a subclass of `Error`) for misuse and for failures of the TypeScript service. Messages follow the [error style](../language.md#3-error-messages): what happened, the location or names involved, and a hint.

| Situation | Behavior |
| --- | --- |
| TypeScript returns no data | Not an error: empty list or `null` |
| The TypeScript service throws during an observation | `SelenitaError` naming the request and marker, with a fixture excerpt and the original error as `cause`. The project stays usable. |
| Invalid configuration, interpolation, or marker usage | `SelenitaError` at the call that caused it |
| Unknown marker in `at`, `range`, `across` | `SelenitaError` listing the available names |
| Reading a single-cursor field on a result with zero or several cursors | `SelenitaError` listing cursors and pointing to `at()` |
| Query on a disposed project; first read after disposal | `SelenitaError` |
