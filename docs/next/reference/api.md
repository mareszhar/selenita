# API reference

The exact public contract of `@mszr/selenita`. Guides explain how to use it; this page says precisely what it does. Matchers have [their own reference](./matchers.md).

## Contents

- [Entry points](#entry-points)
- [Projects](#projects): [`createProject`](#createproject), [`defineProject`](#defineproject), [`ProjectConfig`](#projectconfig), [layers](#configuration-layers), [`Project`](#project), [plugins](#plugins)
- [Fixtures](#fixtures): [`cursor`](#cursor), [`mark`](#mark), [`snippet`](#snippet), [interpolation](#interpolation), [files](#fixture-files)
- [Results](#results): [`QueryResult`](#queryresult), [`CheckResult`](#checkresult), [`Observations`](#observations), [laziness](#laziness-and-activation)
- [Observation types](#observation-types): [`Completion`](#completion), [`Hover`](#hover), [`SignatureHelp`](#signaturehelp), [`InlayHint`](#inlayhint), [`Rename`](#rename), [`Diagnostic`](#diagnostic), [`CodeFix`](#codefix), [`Range`](#range)
- [`compareCompletions`](#comparecompletions)
- [Errors](#errors)

## Entry points

| Import | Contains | Use it |
| --- | --- | --- |
| `@mszr/selenita` | `createProject`, `cursor`, `mark`, `snippet`, `compareCompletions`, `SelenitaError`, all types | Outside Vitest — scripts, benchmarks, other runners — and in testing kits that should not depend on a runner |
| `@mszr/selenita/vitest` | Everything above, plus `defineProject`; installs the [matchers](./matchers.md) and their types | In Vitest test files and test-support modules |

Both are ESM. Node 22.12+ can `require()` them. The Vitest entry requires Vitest 5.

## Projects

### `createProject`

```ts
function createProject(...configs: ProjectConfig[]): Project
```

Creates a project the caller owns from one or more configuration [layers](#configuration-layers). Validates every layer immediately; builds the TypeScript program on first use or on `warmUp()`. Release it with `dispose()` or `using`.

### `defineProject`

```ts
function defineProject(...configs: ProjectConfig[]): Project // from '@mszr/selenita/vitest'
```

`createProject` plus Vitest lifecycle: registers `beforeAll(() => project.warmUp())` and `afterAll(() => project.dispose())` in the scope where it is called. Throws when called while a test is running; use `createProject` with `using` there, or derive with `project.extend()`.

### `ProjectConfig`

```ts
interface ProjectConfig {
  /** Path to a tsconfig, relative to the working directory. Default: nearest tsconfig.json walking up from the working directory. `false`: in-memory defaults. */
  tsconfig?: string | false
  /** Compiler options in tsconfig.json spelling, applied over the tsconfig. */
  compilerOptions?: CompilerOptionsJson
  /** Editor preferences (TypeScript's `UserPreferences`), applied over selenita's defaults. */
  preferences?: ts.UserPreferences
  /** Virtual files for the project's lifetime. Keys resolve from the project root. */
  files?: Record<string, string>
  /** Import specifiers mapped to paths (tsconfig `paths` semantics; `*` wildcards). Values resolve from the project root. */
  aliases?: Record<string, string>
  /** Language-service plugins, applied in order: a factory, or a factory with its config. */
  plugins?: readonly PluginEntry[]
}

type CompilerOptionsJson = { [K in keyof ts.CompilerOptions]?: JsonValue }
type PluginEntry = Plugin | readonly [Plugin, Record<string, unknown>]
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

**Default preferences** describe a typical editor, so completions match what users see. Every key can be overridden:

| Preference | Default | Effect |
| --- | --- | --- |
| `includeCompletionsWithInsertText` | `true` | Suggests members that need special insertion, such as `fruit['red-apple']`. |
| `includeAutomaticOptionalChainCompletions` | `true` | Suggests members of possibly-undefined values, inserting `?.`. |
| `includeCompletionsForModuleExports` | `false` | Auto-import suggestions. Opt in: they are costly and flood identifier positions. |
| Every `includeInlay…` hint preference | on (`includeInlayParameterNameHints: 'all'`) | `inlayHints` shows every kind of hint. Turn individual kinds off to match a specific editor setup. |

### Configuration layers

`createProject`, `defineProject`, and `project.extend` take any number of configs. Later layers refine earlier ones:

| Key | How layers combine |
| --- | --- |
| `tsconfig` | The last layer that sets it wins. |
| `compilerOptions`, `preferences`, `files`, `aliases` | Merged by key; for the same key, the later layer wins. |
| `plugins` | Concatenated in layer order. |

So `defineProject(base, { files: { 'extra.d.ts': '…' } })` keeps every file in `base` and adds one.

### `Project`

```ts
interface Project {
  query: QueryTag // see Fixtures
  check: CheckTag
  extend: (...configs: ProjectConfig[]) => Project
  warmUp: () => void // build the initial program now
  dispose: () => void // idempotent
  [Symbol.dispose]: () => void // same as dispose()
}
```

- One project owns one TypeScript language service. Projects never share semantic state.
- `extend(...configs)` derives a new project from this project's layers plus `configs`. The derived project is independent (its own service, built on first use), and **owned by its parent**: disposing the parent disposes it. Dispose it earlier with `dispose()` or `using`. Deriving from a disposed project throws.
- `warmUp()` builds the initial program for the project's configuration. Queries can still do substantial work later: fixtures change the program, and each observation runs its own request.
- `query`, `check`, and `extend` throw on a disposed project.

### Plugins

```ts
type Plugin = ts.server.PluginModuleFactory
```

A plugin is a TypeScript language-service plugin factory — the default export of a tsserver plugin module — so a typed plugin is accepted without a cast. selenita calls `factory({ typescript })` with its own TypeScript instance, then `create(info)` once per project, in order, each wrapping the previous service. Every observation uses the final service.

selenita is a lighter host than tsserver. `info` provides:

| Member | Provided |
| --- | --- |
| `languageService`, `languageServiceHost` | The project's service (wrapped by earlier plugins) and host. |
| `config` | The entry's config, or `{}`. |
| `project` | `getCurrentDirectory()`, `getCompilerOptions()`, `getProjectName()`, and `projectService.logger` (logging is discarded). |
| anything else (`serverHost`, `session`, other `project` members) | Not provided. Reading one throws a `SelenitaError` naming the member, so a plugin that needs a full tsserver fails clearly instead of misbehaving. |

A plugin sees virtual files through the service and host. A plugin that reads the file system directly (with `node:fs`) sees the disk. A plugin that throws during `create` fails the project's first use, with the plugin's error as `cause`.

## Fixtures

```ts
interface QueryTag {
  <const V extends readonly Interpolation[]>(strings: TemplateStringsArray, ...values: V): QueryResult<CursorsOf<V>, MarksOf<V>>
  <const F extends Files>(files: F): QueryResult<CursorsOf<F>, MarksOf<F>>
}
interface CheckTag {
  <const V extends readonly Interpolation[]>(strings: TemplateStringsArray, ...values: V): CheckResult<CursorsOf<V> | MarksOf<V>>
  <const F extends Files>(files: F): CheckResult<CursorsOf<F> | MarksOf<F>>
}

type Files = Readonly<Record<string, string | Snippet>>
type Interpolation = string | Cursor | Mark | Snippet | readonly Interpolation[]
```

Marker names are inferred from the interpolated values — through snippets, scopes, arrays, nested marks, and record files — so `at`, `range`, and `atEach` autocomplete them and reject unknown literals at compile time. Names built from runtime strings widen to `string`.

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
  /** The same snippet with every marker name prefixed by `name.` */
  scope: <const S extends string>(name: S) => Snippet<`${S}.${C}`, `${S}.${M}`>
}
```

Snippets are immutable and inert. `.scope()` returns a new snippet; scopes compose outside-in. Scopes namespace marker names only — not TypeScript declarations.

### Interpolation

| Value | Contributes |
| --- | --- |
| `string` | its text |
| `cursor`, `cursor(name)` | a cursor at that point |
| ``mark(name)`…` `` | its text, plus a mark over it |
| `snippet` | its text and markers (names prefixed by any `.scope()` scopes) |
| array | each element in order, **with no separator** |
| anything else | throws `SelenitaError` naming the value's type |

| Marker rule | On violation |
| --- | --- |
| Names are one segment: non-empty, no `.`, no whitespace | throws at the `cursor()`/`mark()` call |
| Names are unique across the whole fixture | throws, naming the duplicate; hint: `.scope(name)` |
| A bare cursor is the fixture's only cursor | throws; hint: name every cursor |
| `check` fixtures contain no bare cursor (nothing could refer to it) | throws; hint: name it, or use `query` |
| `query` fixtures contain at least one cursor or mark | throws; hint: `check` |

### Fixture files

- **Template form**: one file, `__selenita__.ts`, in the project root.
- **Record form**: one file per key. Relative keys resolve from the project root; absolute keys are used as-is. The extension selects the script kind (`.ts`, `.tsx`, `.mts`, `.cts`, `.d.ts`, `.js`, `.jsx`, …).
- A fixture file whose path matches a real or project file replaces it for the duration of that query.
- Fixture text is the exact concatenation of the template — no dedent, no trimming, no separators between array elements.

## Results

### `QueryResult`

```ts
interface QueryResult<C extends string, M extends string> extends Observations {
  at: (name: C | M) => Observations
  rangeOf: (name: C | M) => Range
  atEach: <L extends ScopedLast<C>>(name: L, scopes?: readonly ScopeOf<C, L>[]) => Record<string, Observations>
  readonly errors: readonly Diagnostic[]
  readonly diagnostics: readonly Diagnostic[]
  readonly inlayHints: readonly InlayHint[]
  readonly files: Readonly<Record<string, string>>
  inspect: <T>(fn: (context: InspectionContext) => T) => T
}
```

| Member | Semantics |
| --- | --- |
| `Observations` fields on the result itself | The fixture's only cursor. Present only when the fixture has exactly one cursor; otherwise reading one throws, listing the cursor names and pointing to `at()`. |
| `at(name)` | Observations at a cursor, or at the start of a mark. Unknown name throws, listing names. A bare cursor has no name: `at()` throws with a hint to read the result directly. |
| `rangeOf(name)` | The marker's range. Cursors have empty ranges (`start` equals `end`, `text` is `''`). |
| `atEach(name)` | Every scoped cursor named `<scope>.<name>`, keyed by `<scope>` (everything before the final segment), in fixture order. Throws when none exists, listing cursor names. |
| `atEach(name, scopes)` | Exactly those scopes, in that order. Throws if any listed scope lacks the cursor, naming it — so a member left out of a fan-out cannot go unnoticed. |
| `errors` | Diagnostics with severity `error`, across all fixture files. |
| `diagnostics` | All diagnostics across all fixture files: syntactic, semantic, then suggestion; within each, by file then position. |
| `inlayHints` | Inlay hints across all fixture files, by file then position. |
| `files` | The flattened source of each fixture file, keyed as written (template form: `__selenita__.ts`). |
| `inspect(fn)` | Activates this result's fixture, then calls `fn` synchronously with raw TypeScript access. `fn` must not return a promise (the fixture is only guaranteed active during the call); a thenable result throws. |

```ts
interface InspectionContext {
  service: ts.LanguageService // the project's service, plugins applied
  typescript: typeof ts // the backend module
  resolvePath: (file: string) => string // fixture or project-relative path → absolute file name
}
```

### `CheckResult`

```ts
interface CheckResult<N extends string> {
  rangeOf: (name: N) => Range
  readonly errors: readonly Diagnostic[]
  readonly diagnostics: readonly Diagnostic[]
  readonly inlayHints: readonly InlayHint[]
  readonly files: Readonly<Record<string, string>>
  inspect: <T>(fn: (context: InspectionContext) => T) => T
}
```

Same semantics as the matching `QueryResult` members. In a check, named cursors and marks are locations only.

### `Observations`

```ts
interface Observations {
  readonly completionNames: readonly string[]
  findCompletion: (selector: string | { name: string, source?: string }) => Completion | undefined
  readonly completions: readonly Completion[]
  readonly hover: Hover | null
  readonly signatureHelp: SignatureHelp | null
  readonly rename: Rename
}
```

| Field | TypeScript request | Empty when |
| --- | --- | --- |
| `completionNames` | `getCompletionsAtPosition` | `[]` when TypeScript offers none |
| `completions` | the same request; details resolve per completion, on first read | `[]` |
| `findCompletion(selector)` | the first completion matching the name (and `source`, when given) | `undefined` when not offered |
| `hover` | `getQuickInfoAtPosition` | `null` when TypeScript has no quick info |
| `signatureHelp` | `getSignatureHelpItems` | `null` outside a call's arguments |
| `rename` | `getRenameInfo`, then `findRenameLocations` | `{ canRename: false, … }` |

`completionNames` lists names in TypeScript's order, with quotes removed from string-literal entries (`'asc'` → `asc`). Duplicates are kept; select among them with `{ name, source }`.

### Laziness and activation

A result is a lazy view: each observation is computed the first time it is read, then kept. Observation fields are enumerable, so `toEqual` and snapshots see them — and reading them computes them. That is why it is best to snapshot the fields a promise concerns, not whole results. Methods are not enumerable.

A project shows the editor one fixture at a time. Reading an observation activates its result's fixture first: a no-op when it is already active, otherwise it swaps it back in. Consequences:

- A result always describes its own fixture, even when read after later queries.
- Module augmentations and globals in one fixture never affect another.
- Reading an observation for the first time after its project is disposed throws `SelenitaError` naming the observation; values already read remain.

Returned data is frozen. Freezing never computes an unread field: reading `errors` does not request each diagnostic's `codeFixes`.

## Observation types

### `Completion`

```ts
interface Completion {
  // From the completion list — free once completions are read
  name: string // as in `completionNames`
  kind: CompletionKind // TypeScript's ScriptElementKind
  isDeprecated: boolean
  isOptional: boolean
  isRecommended: boolean // TypeScript marked it as the recommended choice
  source: string | null // the module an auto-import would come from
  insertText: string | null // what accepting inserts, when it differs from the name: '["red-apple"]'
  replacementRange: Range | null // what accepting replaces, when TypeScript says
  sortText: string // TypeScript's ordering key (one input to an editor's ranking, not the ranking)

  // Resolved per completion, on first read
  readonly displayText: string // '(property) QueryOptions.table: string'
  readonly documentation: string // '' when none
  readonly tags: readonly DocTag[]
  readonly codeActions: readonly CodeAction[] // extra edits accepting it would make, e.g. an import
}

interface CodeAction { description: string, edits: readonly TextEdit[] }
type CompletionKind = 'property' | 'method' | 'function' | 'const' | 'let' | 'var' | 'class' | 'interface' | 'type' | 'enum' | 'enum member' | 'module' | 'keyword' | 'alias' | 'parameter' | 'string' | (string & {})
interface DocTag { name: string, text: string }
```

`displayText` is TypeScript's display text, unmodified. It is presentation, not type identity: assert it with `toBe`, `toContain`, or a snapshot, choosing the strength your promise needs. Detail requests forward the entry's `source` and `data`, so auto-import and plugin entries resolve their own details.

### `Hover`

```ts
interface Hover {
  displayText: string // the code-block part: 'const fruit: Fruit'
  documentation: string // the prose part; '' when none
  tags: readonly DocTag[]
  text: string // display text, then documentation, then tags, separated by blank lines
  range: Range // the text the hover describes
}
```

`text` renders tags as `@name text`, one per line, in TypeScript's order.

### `SignatureHelp`

```ts
interface SignatureHelp {
  signatures: readonly Signature[] // every overload
  activeSignature: Signature // the overload in use
  activeParameter: Parameter | null // the parameter being typed, in the active overload
  activeSignatureIndex: number // zero-based, into signatures
  activeParameterIndex: number // zero-based, into activeSignature.parameters, as TypeScript reports it
}
interface Signature { label: string, documentation: string, tags: readonly DocTag[], parameters: readonly Parameter[] }
interface Parameter { name: string, label: string, documentation: string }
```

For a rest parameter, TypeScript reports every argument at or past it as the rest parameter, so `activeParameter` is the rest parameter there. `activeParameter` is `null` when no parameter applies.

### `InlayHint`

```ts
interface InlayHint {
  text: string // ': string', 'count:'
  kind: 'parameter' | 'type' | 'enum'
  range: Range // empty, at the position the hint is shown
}
```

Inlay hints are what an editor draws inline: parameter names before arguments, inferred types after declarations. Requested once per fixture file with the project's [preferences](#projectconfig) (every kind on by default). Compare a hint's position with a cursor placed there: `range` equals `result.rangeOf('cursorName')`.

### `Rename`

```ts
interface Rename {
  canRename: boolean
  reason: string | null // TypeScript's message when canRename is false
  locations: readonly RenameLocation[] // [] when canRename is false
}
interface RenameLocation extends Range {
  prefixText?: string // present only when TypeScript supplies non-empty text
  suffixText?: string
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
  relatedInformation: readonly RelatedInformation[]
  readonly codeFixes: readonly CodeFix[] // resolved on first read
}
interface RelatedInformation { message: string, range: Range | null }
```

### `CodeFix`

```ts
interface CodeFix {
  description: string
  edits: readonly TextEdit[] // text changes, including files the fix creates
  /** The fixture's files with these edits applied, plus any other file the edits change or create. */
  readonly fixedFiles: Readonly<Record<string, string>>
}
interface TextEdit { range: Range, newText: string }
```

`codeFixes` requests `getCodeFixesAtPosition` for the diagnostic's range and code. `fixedFiles` is computed on first read, as a text transformation: edits are applied per file from the end backwards, giving a valid record-form fixture, so `project.check(fix.fixedFiles)` re-checks the fixed code. Overlapping edits throw. Reading `fixedFiles` on a fix that also needs an editor command (which text cannot represent) throws, naming the command; its `edits` remain readable.

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

## `compareCompletions`

```ts
function compareCompletions(members: Readonly<Record<string, Observations | readonly Completion[] | readonly string[]>>): CompletionComparison

interface CompletionComparison {
  hasParity: boolean
  baseline: readonly string[] // the set shared by the most members; ties go to the first member
  differences: Readonly<Record<string, { added: readonly string[], removed: readonly string[] }>> // divergent members only
}
```

The judgment behind [`toHaveCompletionParity`](./matchers.md#tohavecompletionparity), as data — for scripts, other runners, and reports. Compares sets: order and duplicates are ignored. Typically given `result.atEach(name, scopes)`.

## Errors

selenita throws `SelenitaError` (a subclass of `Error`) for misuse and for failures of the TypeScript service. Messages follow the [error style](../language.md#3-error-messages): what happened, the location or names involved, and a hint.

| Situation | Behavior |
| --- | --- |
| TypeScript returns no data | Not an error: empty list or `null` |
| The TypeScript service throws during an observation | `SelenitaError` naming the request and marker, with a fixture excerpt, the backend version, and the original error as `cause`. The project stays usable. |
| Invalid configuration, interpolation, or marker usage | `SelenitaError` at the call that caused it |
| Unknown marker in `at`, `range`, `atEach`; a listed scope missing in `atEach` | `SelenitaError` listing the available names |
| Reading a single-cursor field on a result with zero or several cursors | `SelenitaError` listing cursors and pointing to `at()` |
| A plugin reads a host member selenita does not provide | `SelenitaError` naming the member |
| Query on, or derivation from, a disposed project; first read after disposal | `SelenitaError` |
