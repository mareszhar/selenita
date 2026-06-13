# selenita — Library Specification

**Status:** v0.1.0 — Initial implementation complete

> A TypeScript library for writing IntelliSense tests. selenita exposes the TypeScript Language Service through a high-DX tagged-template API, letting you assert on completions, hover text, diagnostics, signature help, inlay hints, and more — with the same fluency you'd expect from a well-designed test utility.

---

## Implementation Status

| Phase | Description | Status |
| --- | --- | --- |
| Phase 1 | Core Foundation — single-cursor query, `project.check`, `cursor` primitive, `defineProject` | ✅ Complete |
| Phase 2 | Full Result Surface — named cursors, `result.at()`, `completionItems`, `signatureHelp`, `inlayHints`, `files` option | ✅ Complete |
| Phase 3 | Composition Primitives — `snippet`, `.for()` scoping, nested cursor namespacing, `group` | ✅ Complete |
| Phase 4 | Group Queries & Parity — `project.queryGroup`, `hasParity`, `divergence` | ✅ Complete |
| Phase 5 | Project Flexibility — `aliases`, `project.with()`, `project.forModes()`, `project.entry` | ✅ Complete |
| Phase 6 | Matcher Addon — `selenita/vitest`, all matchers | ✅ Complete |
| Phase 7 | Polish & Escape Hatches — `project.languageService`, `project.virtualPath()`, `project.positionOf()`, TSDoc, error messages | ✅ Complete |

**Pending items (v1.x):**

- Performance benchmarks (§15)

---

## Table of Contents

1. [Vision & Philosophy](#1-vision--philosophy)
2. [Design Principles](#2-design-principles)
3. [Package Layout](#3-package-layout)
4. [Core Primitives](#4-core-primitives)
5. [Project Setup](#5-project-setup)
6. [Core Query API](#6-core-query-api)
7. [Result Shapes](#7-result-shapes)
8. [Named Cursors & Multi-position Queries](#8-named-cursors--multi-position-queries)
9. [Snippets](#9-snippets)
10. [Groups & Parity](#10-groups--parity)
11. [Mode Matrix](#11-mode-matrix)
12. [Scoped Project Overrides](#12-scoped-project-overrides)
13. [Custom Matchers — selenita/vitest](#13-custom-matchers--selenitavitest)
14. [Error Handling Contract](#14-error-handling-contract)
15. [Performance & Caching Model](#15-performance--caching-model)
16. [Concurrency Model](#16-concurrency-model)
17. [Extensibility & Escape Hatches](#17-extensibility--escape-hatches)
18. [Out of Scope — v1](#18-out-of-scope--v1)
19. [Phased Implementation Roadmap](#19-phased-implementation-roadmap)
20. [Complete Real-World Example](#20-complete-real-world-example)

---

## 1. Vision & Philosophy

TypeScript's value as a language comes largely from the guarantees it provides to tooling: when you write `registerFruit({ })`, your editor knows which keys belong there, which are optional, what their types are, and which ones are deprecated. These are behavioral guarantees of your library's type surface — and like any behavior, they can regress silently.

selenita exists because that type surface deserves the same regression protection as runtime behavior. Just as you'd test that `registerFruit({ neim: 'apple' })` throws at runtime, you should be able to assert that it produces a type error at authoring time. Just as you'd test that `db.queryOnce` and `db.useQuery` behave consistently at runtime, you should be able to verify that they offer identical autocomplete in every equivalent position.

The library is designed around a central conviction: **writing IntelliSense tests should feel like writing any other test.** No line/column arithmetic, no magic comment strings, no separate DSL to learn. The TypeScript code under test lives as real code inside tagged template literals. Cursors are first-class JavaScript values interpolated directly into that code. Results are plain objects you pass to your test runner's `expect`. The mental model is minimal, the output is readable, and the tests are self-explanatory to anyone — human or agent — encountering them for the first time.

---

## 2. Design Principles

These principles govern every design decision in selenita. When requirements conflict, earlier principles take precedence. When adding new features in future versions, evaluate them against this list.

**Self-documenting.** A person or agent reading selenita tests without context should understand what is being tested and why. Names should match mental models. Structure should reflect intent. Comments should be optional, not required for comprehension.

**Empathetic.** Design for the moment of use. What is the user thinking? What would feel natural? What would feel like friction? The best API is one that disappears — the user thinks about their problem, not the library. When multiple solutions exist, choose the one that fits the mental model of someone trying to understand the code, not the one that was technically simpler to implement.

**DRY as a first-class feature.** Boilerplate is an active harm. Repeated structure in tests obscures the variance that actually matters. Snippets, groups, and the mode matrix exist specifically to let you write a pattern once and exercise it across every variant that matters.

**Configurable over opinionated.** Where there is no objectively correct answer, offer a choice rather than forcing one path. But only expose configuration when the alternative would genuinely limit users — unnecessary options are their own form of friction.

**Modular & extensible.** Core selenita is a focused primitive. Optional addons (Vitest matchers, future domain packs) augment it without changing its semantics. Escape hatches give power users access to the raw language service when the library doesn't cover their case. New features should be addable without breaking existing APIs.

**YAGNI with foresight.** Build for the 80% case first. The 20% case that only appears in niche scenarios should not make the 80% case worse. Defer, but design deliberately — defer in a way that leaves the door open without committing to an implementation that would paint us into a corner.

**Plain values.** Results are plain JavaScript objects — strings, arrays, booleans, null. No custom assertion chains on result objects. No special matchers required for basic use. Everything works natively with your test runner's `expect` out of the box.

**Synchronous.** The TypeScript Language Service is synchronous. selenita is synchronous. Forced `await` on queries would be pure noise with no benefit. Project initialization (I/O and program construction) is the one async step, and it is abstracted away entirely.

---

## 3. Package Layout

```
@mszr/selenita              # core, runner-agnostic
@mszr/selenita/vitest       # optional: extends global expect with selenita matchers
```

**Peer dependencies:** `typescript` (>=6.0.0 validated), `vitest` (only when using the matcher addon).

> **`@mszr/selenita/vitest` is ESM-only.** Vitest is ESM-first and `expect.extend()` is a side-effect import; there is no meaningful CJS path. CJS projects cannot `require('@mszr/selenita/vitest')` — use the matcher addon only in ESM test files (which is the norm with Vitest).

**Core has zero runtime dependencies** beyond TypeScript itself. It uses only the TypeScript compiler API (`typescript` package) and Node's built-in `fs` module for reading `tsconfig.json` and resolving paths. The Vitest addon imports `expect` from `vitest` at runtime (to call `expect.extend()`) and requires Vitest to be installed; this is why `vitest` is declared as an optional peer dependency. Users who only use the core package never need Vitest installed.

---

## 4. Core Primitives

```ts
import { cursor, defineProject, group, snippet } from '@mszr/selenita'
```

### `cursor`

`cursor` is both a bare value (for the unnamed, single-cursor case) and a callable (for the named, multi-cursor case). The visual distinction is intentional: bare means "simple case," called means "I am naming this position."

```ts
cursor // unnamed cursor — used when there is only one cursor in the query
cursor('root') // named cursor — required when the query contains more than one cursor
```

Internally `cursor` is a function with an additional sentinel property that makes the bare form work as an interpolation value. Implementors may use a Proxy, `Object.assign` over a function, or a class instance — the public contract is the usage shown above.

`cursor` is meaningful only inside `project.query` or `snippet` tagged templates. Using it elsewhere is a no-op from selenita's perspective — the cursor value is simply ignored and no language-service query is performed for it. There is no runtime error for arbitrary misuse outside these contexts.

### `snippet`

A reusable, composable code fragment that carries its own cursors. Defined with the `snippet` tagged template tag.

```ts
const whereClause = snippet`{ status: 'open', ${cursor('where')} }`
```

A snippet:

- Captures its interpolated cursors at definition time.
- Is inert until it appears as an interpolation inside a `project.query` or another `snippet`.
- May be used in multiple positions within the same query by scoping each use with `.for('alias')`.

### `group`

A labeled or unlabeled list of equivalent API expressions to test for parity.

```ts
group(['db.queryOnce', 'db.useQuery', 'db.useInfiniteQuery']) // anonymous
group('queryApis', ['db.queryOnce', 'db.useQuery', 'db.useInfiniteQuery']) // named
```

The label in the named form is cosmetic only — it appears in test failure output and log messages. It does not affect cursor addressing. Both forms are fully functional.

---

## 5. Project Setup

### `defineProject(config?)`

Creates a project handle. The call is synchronous. All async work (reading tsconfig, resolving modules, constructing the TS Program) is deferred to a `beforeAll` that selenita registers automatically at the call site's scope.

```ts
// Zero-config — auto-detects the nearest tsconfig.json, falls back to strict in-memory TS
const project = defineProject()

// With tsconfig — resolves real src/ paths, path aliases, and node_modules
const project = defineProject({ tsconfig: './tsconfig.json' })

// With virtual type declarations — simulate installed packages or custom .d.ts files
const project = defineProject({
  tsconfig: './tsconfig.json',
  files: {
    'node_modules/my-lib/index.d.ts': `
      export declare function registerFruit(fruit: Fruit): void
      export interface Fruit { name: string; price: number; availableQuantity: number }
    `,
  },
})

// With path aliases — maps import specifiers to real paths, following tsconfig paths convention
const project = defineProject({
  tsconfig: './tsconfig.json',
  aliases: {
    '#core': '../../core/index', // single-file alias
    '#fixtures/*': './tests/fixtures/*', // directory alias — * is the wildcard segment
  },
})
```

### Configuration reference

```ts
interface DefineProjectConfig {
  /**
   * Path to a tsconfig.json. If omitted, selenita auto-detects the nearest tsconfig.json
   * walking up from the directory where the test runner is invoked (i.e., `process.cwd()`).
   * If none is found, a strict in-memory TypeScript context is used.
   */
  tsconfig?: string

  /**
   * Virtual files to inject into the in-memory file system. Keys are file paths relative
   * to the project root. These files exist only in memory and never touch disk. Useful for
   * simulating installed packages, custom .d.ts files, or hypothetical type environments.
   */
  files?: Record<string, string>

  /**
   * TypeScript path aliases, following the same convention as tsconfig `paths`.
   * Keys are import specifiers (with optional `*` wildcard).
   * Values are filesystem paths relative to the project root (with matching `*`).
   *
   * Convention: prefix aliases with `#` to distinguish them from package names.
   * This follows Node.js package exports convention and is familiar to TypeScript users.
   *
   * Example:
   *   '#core': '../../core/index'
   *   '#fixtures/*': './tests/fixtures/*'
   */
  aliases?: Record<string, string>
}
```

### Lifecycle — auto-registered hooks

`defineProject` must be called at module scope or at the top level of a `describe` callback — never inside a test callback. selenita intentionally fails fast when lifecycle assumptions are violated, so misuse surfaces as a clear runtime error instead of a warning/no-op.

```ts
// ✓ module scope — beforeAll/afterAll registered for the whole test file
const project = defineProject({ tsconfig: './tsconfig.json' })

describe('my suite', () => {
  // ✓ describe scope — beforeAll/afterAll registered for this describe block only
  const scopedProject = defineProject({ tsconfig: './tsconfig.json' })

  it('a test', () => {
    // ✗ test scope — invalid, throws when accessed before initialization
    const bad = defineProject()
  })
})
```

Internally, `defineProject` calls `beforeAll(async () => { /* build Program */ })` and `afterAll(() => { /* dispose Program */ })` using the test runner globals. This means:

- No lifecycle boilerplate for the user.
- Lifecycle scope follows standard test runner rules.
- The TS Program is built exactly once per project per test run.

### `project.ready()`

An async method that resolves when the `beforeAll`-registered initialization is complete. Not needed in normal use — the test runner's lifecycle ordering guarantees that `beforeAll` finishes before any test body runs, so queries are always called after initialization. Provided as an escape hatch for advanced scenarios where explicit readiness tracking is useful (e.g., a shared project exported from a setup file that other `beforeAll` hooks want to await explicitly).

```ts
await project.ready()
```

Note: `project.ready()` (like all project methods) is only accessible after `defineProject`'s own `beforeAll` has run. Accessing it at module scope before the test runner initializes the project will throw.

---

## 6. Core Query API

### `project.query` — language service probe

The primary API. Takes a tagged template literal containing TypeScript code with at least one cursor interpolation. Returns a result object with full language service data.

```ts
// Single unnamed cursor — access results directly on the returned object
const result = project.query`
  import { registerFruit } from './src'
  registerFruit({ ${cursor} })
`

result.completions // string[]
result.hover // string | null
result.signatureHelp // SignatureHelp | null
result.inlayHints // InlayHint[]
result.diagnostics // Diagnostic[]  — all diagnostics for the virtual file
result.errors // Diagnostic[]  — severity === 'error'
result.warnings // Diagnostic[]  — severity === 'warning'

// Rich completion access
result.completionItems // CompletionItem[]
result.completionItem('name') // CompletionItem | undefined
result.completionItemsOfKind('property') // CompletionItem[]
```

A query with no cursor throws at runtime with a clear message directing the user to `project.check` for the diagnostic-only path.

### `project.check` — diagnostics only

No cursor required. Returns only diagnostic information. Use this to assert that code produces (or does not produce) type errors.

```ts
const result = project.check`
  import { registerFruit } from './src'
  registerFruit({ neim: 'apple' })
`

result.diagnostics // Diagnostic[]
result.errors // Diagnostic[]
result.warnings // Diagnostic[]
result.inlayHints // InlayHint[]
```

### Template interpolation rules

Inside `project.query` and `snippet` tagged templates, interpolated values are handled as follows:

| Interpolated value | Treatment |
| --- | --- |
| `cursor` (bare) | Unnamed cursor position |
| `cursor('name')` | Named cursor position |
| `snippet\`...\`` | Expand snippet inline, merge cursors |
| `snippet.for('alias')` | Expand snippet, namespace its cursors under `alias` |
| `string` | Insert as literal TypeScript code |
| Anything else | Runtime error with a clear message |

String interpolation enables patterns like `project.entry` in mode matrix tests (see §11).

Inside `project.check` tagged templates, the allowed interpolations are a subset:

| Interpolated value | Treatment |
| --- | --- |
| `snippet\`...\`` | Expand snippet inline; **cursor positions inside the snippet are silently dropped** |
| `snippet.for('alias')` | Same — cursor positions dropped |
| `string` | Insert as literal TypeScript code |
| `cursor` / `cursor('name')` | **Runtime error** — cursors are not valid in `project.check` |
| Anything else | Runtime error with a clear message |

The silent-drop rule for snippet cursors enables composability: the same snippet can be defined once with cursor positions (for `project.query` tests) and reused in `project.check` contexts without modification.

### `project.queryGroup` — multi-API parity query

A curried function for testing a group of equivalent APIs together. The first call configures which APIs to test and how to generate each call. The tagged template that follows provides the shared prelude (typically imports).

```ts
project.queryGroup(groupPrimitive, factory)`prelude`
```

- `groupPrimitive` — a `group([...])` or `group('label', [...])` value
- `factory` — a function `(api: string) => Snippet` that, given an API expression string, returns the snippet representing one call to that API
- The tagged template is the shared setup code (imports, shared variable declarations) that all generated calls share

selenita assembles one virtual file containing the prelude followed by a generated call for each group member, with each member's cursors automatically scoped to `{apiName}.{cursorName}`.

```ts
const queryApis = group('queryApis', [
  'db.queryOnce',
  'db.queryOnceX',
  'db.useQuery',
  'db.useQueryX',
  'db.useInfiniteQuery',
])

const rootArg = snippet`{ workspaces: {}, ${cursor('root')} }`

const result = project.queryGroup(queryApis, api => snippet`${api}(${rootArg})`)`
  import { db } from './src'
`
```

The assembled virtual file in the above example looks roughly like:

```ts
import { db } from './src'

db.queryOnce({ workspaces: {}, /* cursor:db.queryOnce.root */ })
db.queryOnceX({ workspaces: {}, /* cursor:db.queryOnceX.root */ })
db.useQuery({ workspaces: {}, /* cursor:db.useQuery.root */ })
// ...
```

Result access is covered in §10.

---

## 7. Result Shapes

### TypeScript interfaces

```ts
interface CompletionItem {
  name: string
  kind: 'property' | 'method' | 'variable' | 'keyword' | 'class'
    | 'interface' | 'type' | 'enum' | 'module' | 'function' | 'constructor'
  type: string // full display string, e.g. "(property) Fruit.name: string"
  documentation: string // JSDoc or other attached documentation; empty string if none
  isDeprecated: boolean
  isOptional: boolean
  isRecommended: boolean // true when the TS language service marks it as recommended
}

interface Diagnostic {
  message: string
  code: number // TypeScript error code, e.g. 2339
  severity: 'error' | 'warning' | 'suggestion'
  line: number // 1-indexed
  column: number // 1-indexed
}

interface SignatureHelp {
  signatures: Array<{
    label: string // full signature string, e.g. "registerFruit(fruit: Fruit): void"
    documentation: string
    parameters: Array<{
      label: string
      documentation: string
    }>
  }>
  activeSignature: number // index of the active overload (zero-indexed)
  activeParameter: number // index of the active parameter (zero-indexed)
}

interface InlayHint {
  text: string // e.g. "fruit:", ": Fruit"
  kind: 'parameter' | 'type' | 'enum'
  line: number // 1-indexed
  column: number // 1-indexed
}
```

### Query result (`project.query`)

`project.query` always returns a single `QueryResult` — there is no separate type for single-cursor vs multi-cursor queries. All `SingleCursorResult` fields are always present. For single-cursor queries they carry the cursor's data; for multi-cursor queries they are empty/null and you use `.at(name)` to access per-cursor data. `.at()` is always present; for bare-cursor queries it throws a helpful error pointing you to direct property access.

This unified shape was chosen deliberately over a narrowed union: it avoids type guards at the call site and means the same variable always has the same shape regardless of cursor count.

```ts
interface SingleCursorResult {
  // Completions
  completions: string[]
  completionItems: CompletionItem[]
  completionItem: (name: string) => CompletionItem | undefined
  completionItemsOfKind: (kind: CompletionItem['kind']) => CompletionItem[]

  // Language service data at cursor position
  hover: string | null
  signatureHelp: SignatureHelp | null
  inlayHints: InlayHint[]

  // File-wide diagnostics (scoped to the virtual file only — see §14)
  diagnostics: Diagnostic[]
  errors: Diagnostic[]
  warnings: Diagnostic[]
}

// Returned by project.query — unified shape for both single- and multi-cursor queries.
// SingleCursorResult fields are always present; .at() is always callable.
interface QueryResult extends SingleCursorResult {
  at: (cursorName: string) => SingleCursorResult
}
```

### Diagnostic-only result (`project.check`)

```ts
interface CheckResult {
  diagnostics: Diagnostic[]
  errors: Diagnostic[]
  warnings: Diagnostic[]
  inlayHints: InlayHint[]
}
```

### Group query result (`project.queryGroup`)

Covered in detail in §10.

---

## 8. Named Cursors & Multi-position Queries

When a query contains more than one cursor, every cursor must be named. The result's `.at()` method addresses each cursor's data by name.

```ts
const result = project.query`
  import { registerFruit } from './src'
  registerFruit({ ${cursor('empty')} })
  registerFruit({ name: 'apple', ${cursor('remaining')} })
`

result.at('empty').completions // ['name', 'price', 'availableQuantity']
result.at('remaining').completions // ['price', 'availableQuantity']
result.at('empty').hover // string | null
result.diagnostics // Diagnostic[] — file-wide, not per-cursor
```

A query with more than one cursor position has two validation rules:

1. **All cursors must be named.** A bare `cursor` may not appear alongside a named `cursor('name')` in the same query. Doing so throws with: `"Mixed cursor types detected — bare cursor cannot be used alongside named cursors. Replace bare cursor with cursor('name') for all positions."`

2. **All cursor names must be unique.** Two cursors with the same name in the same query (including cursors contributed by snippets that were not scoped with `.for()`) throw with: `"Duplicate cursor name 'name' — each cursor in a query must have a unique name. Use .for('alias') to scope reused snippets."`

These are distinct errors with distinct messages so that the user immediately knows which rule was violated and what to do.

---

## 9. Snippets

### Defining a snippet

```ts
const whereClause = snippet`{ status: 'open', ${cursor('where')} }`
const queryCall = snippet`db.queryOnce(${whereClause})`
```

### Single use — no scoping needed

When a snippet appears only once in a query, its cursor names are unambiguous. No `.for()` needed.

```ts
const result = project.query`
  import { db } from './src'
  db.queryOnce(${whereClause})
`
result.at('where').completions
```

### Multiple uses — scope with `.for()`

When the same snippet appears more than once in a query, scope each use with `.for('alias')` to avoid cursor name collisions. The alias becomes a prefix in the cursor path.

```ts
const result = project.query`
  import { db } from './src'
  db.queryOnce(${whereClause.for('once')})
  db.useQuery(${whereClause.for('hook')})
`
result.at('once.where').completions
result.at('hook.where').completions
```

### Snippet composition

Snippets may be nested. The cursor path is the concatenation of all `.for()` names encountered from outermost to innermost, with the cursor name appended.

**The rule:** only `.for('alias')` calls insert a path segment. Unnamed snippet embedding is transparent — it does not add a path segment.

```ts
const inner = snippet`{ ${cursor('field')} }`
const outer = snippet`{ nested: ${inner} }`

// Unscoped — 'inner' is transparent; path is just 'field'
project.query`someApi(${outer})`
// → result.at('field')

// Outer scoped — path is 'ctx.field'
project.query`someApi(${outer.for('ctx')})`
// → result.at('ctx.field')

// Inner scoped — path is 'inner.field'
const inner = snippet`{ ${cursor('field')} }`
const outer = snippet`{ nested: ${inner.for('inner')} }`
project.query`someApi(${outer})`
// → result.at('inner.field')

// Both scoped — path concatenates all .for() segments
const result = project.query`someApi(${outer.for('ctx')})`
// → result.at('ctx.inner.field')
```

The path is always fully visible in the source code by reading the `.for()` calls — no hidden naming magic.

### Snippets and multiple arguments

To pass multiple arguments to a function call:

```ts
const argA = snippet`{ workspaces: {}, ${cursor('where')} }`
const argB = snippet`{ orderBy: 'createdAt' }`

const result = project.query`
  import { db } from './src'
  db.queryOnce(${argA}, ${argB})
`
result.at('where').completions
```

---

## 10. Groups & Parity

### The `group` primitive

```ts
const queryApis = group([
  'db.queryOnce',
  'db.queryOnceX',
  'db.useQuery',
  'db.useQueryX',
  'db.useInfiniteQuery',
])

// With a label for better failure output
const queryApis = group('queryApis', [
  'db.queryOnce',
  'db.queryOnceX',
  'db.useQuery',
  'db.useQueryX',
  'db.useInfiniteQuery',
])
```

The label is purely cosmetic. It appears in test failure messages and log output. It has no effect on cursor addressing or result access. Anonymous groups are fully functional.

### `project.queryGroup` — full API

```ts
const rootArg = snippet`{ workspaces: {}, ${cursor('root')} }`

const result = project.queryGroup(queryApis, api => snippet`${api}(${rootArg})`)`
  import { db } from './src'
`
```

selenita calls the factory once per group member, passing the API string. Each invocation's cursors are automatically scoped to `{apiName}.{cursorName}`. The user never sees these internal scoped names — they always address via the group result API described below.

### Group result shape

```ts
interface GroupQueryResult {
  // Per-API access — address one specific member.
  // Returns QueryResult (the same unified shape as project.query) so that .at()
  // is always present, matching the philosophy from §7: avoid type guards at the call site.
  for: (apiName: string) => QueryResult

  // Cross-API group analysis
  group: GroupAnalysis

  // File-wide diagnostics across all generated code
  diagnostics: Diagnostic[]
  errors: Diagnostic[]
  warnings: Diagnostic[]
}

interface GroupAnalysis {
  at: (cursorName: string) => GroupCursorResult
}

interface GroupCursorResult {
  // Completions indexed by API name
  completions: Record<string, string[]>

  // True if all group members have identical completion sets (order-insensitive)
  hasParity: boolean

  // Null when hasParity is true; structured divergence report otherwise
  divergence: DivergenceReport | null

  // Label from the named group() call, or null for anonymous groups.
  // Appears in toHaveCompletionParity failure messages for immediate identification.
  label: string | null
}

interface DivergenceReport {
  // The "majority" completion set — the set shared by the most members.
  // If there is a tie, the set of the first-listed member wins.
  baseline: string[]

  // Each member's deviation from baseline.
  // Members that match baseline have empty added/removed arrays.
  members: Record<string, {
    added: string[] // completions present in this member but not in baseline
    removed: string[] // completions in baseline but absent from this member
  }>
}
```

### Usage examples

```ts
// Check that all APIs expose identical completions at 'root'
expect(result.group.at('root').hasParity).toBe(true)

// Inspect a specific API's completions
expect(result.for('db.queryOnce').at('root').completions).toContain('users')

// Access all completions as a record
const allCompletions = result.group.at('root').completions
// → { 'db.queryOnce': ['users', 'memberships', ...], 'db.useQuery': [...], ... }

// Diagnose a parity failure
if (!result.group.at('root').hasParity) {
  console.log(result.group.at('root').divergence)
  // → { baseline: ['users', 'memberships'], members: { 'db.useQueryX': { added: [], removed: ['memberships'] } } }
}
```

### Cross-position parity (two snippets, no group)

For the simpler case of asserting two cursor positions agree, use `toEqualCompletions` from the matcher addon rather than a group:

```ts
expect(result.at('once.where').completions)
  .toEqualCompletions(result.at('hook.where').completions)
```

---

## 11. Mode Matrix

`project.forModes` runs a set of test definitions once per named build target. It is designed for library authors who need to verify that type information survives compilation to CJS, ESM, or other distribution formats.

### Mode configuration

Each mode is either a string shorthand (path to an entry file) or an object with explicit `entry` and optional `dts`:

```ts
project.forModes(
  {
    'source': './src/index.ts',
    'dist-esm': { entry: './dist/index.js', dts: './dist/index.d.ts' },
    'dist-cjs': { entry: './dist/index.cjs', dts: './dist/index.d.ts' },
  },
  (project, mode) => {
    // Everything inside runs once per mode.
    // `project` is a scoped clone configured for that mode.
    // `mode` is the key string ('source', 'dist-esm', 'dist-cjs').
  }
)
```

The `dts` field is required when the entry is a compiled file that lacks embedded type information. selenita injects the declaration file adjacent to the entry using the correct extension pairing: `.js` → `.d.ts`, `.cjs` → `.d.cts`, `.mjs` → `.d.mts`.

### `project.entry`

Inside a `forModes` callback, the scoped project exposes `project.entry` — a plain string containing the current mode's entry path. It is designed for interpolation into query templates:

```ts
project.forModes(modes, (project, mode) => {
  it(`[${mode}] suggests Fruit keys`, () => {
    const { completions } = project.query`
      import { registerFruit } from '${project.entry}'
      registerFruit({ ${cursor} })
    `
    expect(completions).toContain('name')
  })
})
```

### Behavior

- The callback is invoked synchronously at test-definition time, once per mode.
- Each invocation creates its own set of test definitions (via `it` / `test` calls inside).
- Mode programs are built lazily — each mode has its own `LanguageService` but the TypeScript `Program` inside it is only constructed on the first query. A mode whose tests are skipped is never compiled.
- `forModes` does not create its own `describe` block. Test naming (e.g., including `[${mode}]` in the test name) is the user's responsibility.

---

## 12. Scoped Project Overrides

`project.with()` creates a scoped clone of the project with additional or overriding configuration. The clone is immutable and independent — the parent project is not modified.

```ts
const scoped = project.with({
  aliases: { '#mock': './tests/mocks/db' },
  files: {
    'node_modules/my-lib/index.d.ts': `export type Flavor = 'sweet' | 'sour'`,
  },
})
```

### Merge behavior

- `aliases`: merged with the parent project's aliases. Conflicting keys are overridden by the `with()` value. All parent aliases remain active.
- `files`: merged with the parent project's virtual files. Conflicting file paths are overridden by the `with()` value. All parent files remain visible.

### Use cases

**Simulating a third-party package:**

```ts
const scoped = project.with({
  files: {
    'node_modules/hypothetical-lib/index.d.ts': `
      export declare function frobnicate(x: 'a' | 'b' | 'c'): void
    `,
  },
})
const { completions } = scoped.query`
  import { frobnicate } from 'hypothetical-lib'
  frobnicate(${cursor})
`
completions // ['a', 'b', 'c']
```

**Per-test alias override:**

```ts
const mockedProject = project.with({
  aliases: { '#db': './tests/mocks/db' },
})
```

**Composition:**

```ts
const base = project.with({ files: { 'extra.d.ts': `export type Color = 'red' | 'green'` } })
const extended = base.with({ files: { 'more.d.ts': `export type Shape = 'circle' | 'square'` } })
// extended sees both extra.d.ts and more.d.ts
```

`project.with()` creates a new `LanguageService` that inherits the parent's virtual files, real file names, and compiler options. It does **not** share the parent's TypeScript Program; on first query it compiles the full project from scratch (including inherited files). See §15 for the caching model and cost implications.

---

## 13. Custom Matchers — selenita/vitest

### Setup

Add to your Vitest setup file. The import is a side effect — it extends the global `expect` automatically:

```ts
// vitest.setup.ts
import '@mszr/selenita/vitest'
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { setupFiles: ['./vitest.setup.ts'] }
})
```

This is the only configuration required. No `expect.extend(...)` call needed.

The setup file import also carries the TypeScript matcher augmentation. If the setup file is outside `tsconfig.json`'s `include`, users must either include it or append `@mszr/selenita/vitest` to `compilerOptions.types`. They should not need to redeclare matcher signatures in a local `.d.ts` file.

### Completion matchers

```ts
// Applied to result.completions (string[])
expect(result.completions).toContainCompletion('name')
expect(result.completions).toContainCompletions(['name', 'price', 'availableQuantity'])
expect(result.completions).not.toContainCompletion('neim')
// Exact match, order-insensitive
expect(result.completions).toEqualCompletions(['name', 'price', 'availableQuantity'])
```

### CompletionItem matchers

```ts
// Applied to result.completionItem('name') (CompletionItem | undefined)
expect(result.completionItem('name')).toHaveKind('property')
expect(result.completionItem('name')).toHaveType('string')
expect(result.completionItem('name')).toHaveDocumentation(/display name/)
expect(result.completionItem('price')).not.toBeDeprecated()
expect(result.completionItem('legacyField')).toBeDeprecated()
```

### Diagnostic matchers

```ts
// Applied to result.errors or result.diagnostics (Diagnostic[])
expect(result.errors).toBeClean() // no errors
expect(result.errors).toHaveError(2353) // by TS error code
expect(result.errors).toHaveError(/known properties/) // by message pattern
expect(result.errors).toHaveError(2353, /known properties/) // code AND message
expect(result.errors).toHaveErrorCount(1)
```

### Parity matcher

```ts
// Applied to a GroupCursorResult (result.group.at('root'))
expect(result.group.at('root')).toHaveCompletionParity()

// Applied to two string[] for cross-position parity
expect(result.at('once.where').completions)
  .toEqualCompletions(result.at('hook.where').completions)
```

### Signature help matchers

```ts
// Applied to result.signatureHelp (SignatureHelp | null)
expect(result.signatureHelp).toBeActiveOnParameter(0) // zero-indexed
expect(result.signatureHelp).toHaveParameterCount(2)
```

### Type snapshots

A separate snapshot bucket for type-level output. Type signatures change at a different rate than runtime behavior, and mixing them into the same `.snap` file creates noise during routine updates.

```ts
// Applied to result.hover (string | null) or result.completionItems (CompletionItem[])
expect(result.hover).toMatchTypeSnapshot()
expect(result.completionItems).toMatchTypeSnapshot()
```

**Snapshot file location:** `__type_snapshots__/<test-file>.type-snapshot`, adjacent to the test file — e.g. `tests/api.test.ts` → `tests/__type_snapshots__/api.test.ts.type-snapshot`. The full filename including extension is preserved, mirroring Vitest's `__snapshots__` convention (`.test.ts.snap`).

**First run / missing keys:** when a snapshot key does not yet exist, selenita writes the current value and passes — identical to Vitest's built-in snapshot behavior. The snapshot file change will appear in your working tree and can be reviewed in git. On all subsequent runs the stored value is compared normally.

**Updates:** run with `vitest --update` or `-u`. The `--update` flag is detected natively via `__vitest_worker__`; you can also set `VITEST_UPDATE_SNAPSHOT=all` as an explicit override.

**Format:** JSON-serialized strings stored in `__type_snapshots__/[test-filename].type-snapshot`.

---

## 14. Error Handling Contract

### Never throw on invalid positions or missing data

selenita's results are always safe to assert against. An exception from the library should always be a programming error (wrong API usage), never a consequence of testing invalid TypeScript.

| Situation | Behavior |
| --- | --- |
| Cursor in invalid position (e.g., mid-token) | Behavior is delegated to the TypeScript language service. selenita does not throw; fields will contain whatever TypeScript returns at that offset, which may be partial, empty, or non-empty. |
| `completionItem('nonexistent')` | Returns `undefined` |
| Code with parse errors | Parse errors appear in `result.errors`; all other fields represent what TS could partially infer |
| Import fails to resolve | Module-not-found appears in `result.errors` (scoped to the virtual file) |
| Bare `cursor` mixed with named `cursor('name')` in the same query | Runtime error: `"Mixed cursor types detected — bare cursor cannot be used alongside named cursors. Replace bare cursor with cursor('name') for all positions."` |
| More than one bare `cursor` in the same query (no named cursors) | Runtime error: `"Multiple bare cursors found — each cursor in a multi-cursor query must be named. Replace cursor with cursor('name') for each position."` |
| Two cursors share the same name in the same query | Runtime error: `"Duplicate cursor name 'name' — each cursor in a query must have a unique name. Use .for('alias') to scope reused snippets."` |
| Snippet used without `.for()` in a multi-use context | Runtime error via the duplicate-cursor-name path: `"Duplicate cursor name '...' — each cursor in a query must have a unique name. Use .for('alias') to scope reused snippets."` The fix suggestion is embedded in the message. |
| Bare `cursor` used inside a `queryGroup` factory | Runtime error: `"group member '...': bare cursor cannot be used in queryGroup factories — replace cursor with cursor('name') to enable cross-member access via result.group.at('name')."` |
| `cursor` interpolated outside a `project.query` or `snippet` | Runtime error with clear message |
| `defineProject` used without runner lifecycle globals (`beforeAll`/`afterAll`) | Runtime error: `"defineProject() requires a test runner with beforeAll/afterAll globals. Make sure defineProject() is called at module or describe scope (not inside a test), and that your runner exposes beforeAll/afterAll as globals..."` |
| `project` accessed before initialization (e.g., invalid test-scope usage) | Runtime error: `"project is not yet initialized..."` |

### Diagnostics are scoped to the virtual file

`result.errors` and `result.diagnostics` contain diagnostics for the **virtual file only** — the code block you wrote in the template literal. Errors inside files you import (`./src`, `node_modules`) do not appear unless the import statement itself fails (which appears in the virtual file's diagnostics).

This is a natural consequence of how the TS language service API works: `getSemanticDiagnostics` takes a filename and returns diagnostics for that file. No filtering needed; no `ownErrors` property needed.

**Implication:** if `./src` has a type error, it will not pollute your IntelliSense test results. Your tests remain isolated from the state of your source files.

---

## 15. Performance & Caching Model

### One LanguageService per project

A TypeScript `Program` object is expensive to construct. selenita creates exactly one `LanguageService` (and therefore one `Program`) per `project` instance, during the auto-registered `beforeAll`. That single service handles all queries in the test suite.

Each call to `project.query()` adds a transient virtual file to the host (the snippet being inspected), then removes the previous query's virtual file before the next one. TypeScript processes these incremental host changes without recompiling the entire project — only the changed file is re-evaluated. Real files (those listed in `tsconfig.json`, `node_modules`, etc.) are never touched. In practice this means the expensive part — parsing and type-resolving your project's source — happens once, and queries pay only for the small incremental cost of one additional file.

### `project.with()` — lightweight LanguageService fork

`project.with()` creates a new `LanguageService` instance backed by a fresh host that inherits the parent's virtual files, real file names, and compiler options. The call itself is O(1) and cheap: TypeScript's `LanguageService` is lazy — it does not construct the underlying `Program` until the first query. There is no shared program state between the parent and child; on first use the child compiles the full project from scratch (including inherited files). The practical cost is therefore: negligible at fork time, then one full program construction on the first query against the child.

For test suites that fork frequently, prefer a single `defineProject` at module scope and use `project.with()` only when a test genuinely needs an augmented type environment. Avoid creating `project.with()` instances inside a loop where each fork will be queried, as each incurs a full compilation on first use.

### `forModes()` — lazy program construction

Each mode in `forModes()` has its own scoped `LanguageService`. The TypeScript `Program` inside that service is constructed lazily by the TypeScript compiler itself — the first language service call (e.g. the first query) triggers it. `ts.createLanguageService()` is cheap; the expensive program construction (type resolution, symbol tables) only happens on first use. A mode whose tests are never reached (e.g., if only running a subset of tests) is therefore never compiled.

### Disposal

The `afterAll` registered by `defineProject` disposes the program and releases memory. This happens automatically. No manual cleanup needed.

### Performance guidance

For very large monorepos, constructing the TS Program can take several seconds. The recommended pattern is one `defineProject` at module scope per test file, shared across all tests in that file. Creating a new `defineProject` per `describe` or per `it` will be slow and is not recommended unless the test genuinely requires an isolated program.

---

## 16. Concurrency Model

**selenita is safe for concurrent use with no configuration required.**

Vitest runs each test file in its own worker process (or thread). Since `defineProject` is called at module scope, each worker has its own `project` instance with its own `Program`. There is no shared mutable state between workers.

Within a single worker, `project.query` and `project.check` are synchronous. Synchronous operations do not interleave, even in an async test context (they complete fully before the event loop can schedule another). There is no intra-worker concurrency concern.

**Result:** standard Vitest concurrent mode (the default) works without any `singleThread` or `pool: 'forks'` configuration. This is not a workaround — it is a natural property of the synchronous TS language service API combined with Vitest's worker isolation.

The spec should document this fact clearly so users do not add unnecessary configuration out of caution.

---

## 17. Extensibility & Escape Hatches

### `project.languageService`

Exposes the raw TypeScript `LanguageService` instance for cases the selenita API does not cover:

```ts
const ls = project.languageService
const definitions = ls.getDefinitionAtPosition(virtualFilePath, position)
```

The virtual file path and position calculation are internal details. selenita exposes a `project.virtualPath` helper and a `project.positionOf(cursorName)` helper (available after a query has been executed) to make this escape hatch usable.

This is intentionally a power-user escape hatch, not a supported first-class API. Features accessed this way are not covered by selenita's stability guarantees.

### Custom matcher sets

Teams can build domain-specific matcher sets on top of selenita's plain value results, following the same pattern as `selenita/vitest`. A matcher pack for a specific framework (e.g., Zod, Prisma, tRPC) can add semantic matchers without touching selenita's core:

```ts
// selenita-prisma/vitest.ts
import { expect } from 'vitest'

expect.extend({
  toSuggestPrismaModels(received: string[]) { /* ... */ },
})
```

### Framework adapters

`project.with()` and `project.forModes()` provide enough surface area that framework-specific wrappers (e.g., `selenita-angular` that pre-configures the Angular compiler plugin) can be built without forking core selenita.

### Plugin hooks — future (v2+)

The following extension points are reserved for a future plugin system. They are not implemented in v1 but are mentioned here to document the intended expansion path:

- `onProgramCreate` — called after the TS Program is built, allows augmentation
- `onQueryResolved` — called after a query completes, allows post-processing results
- `formatDivergence` — custom rendering for group divergence reports

---

## 18. Out of Scope — v1

The following are deliberately excluded from v1. They may be added in future versions. The architecture is designed so that none of these additions would require breaking API changes.

**Language service features not covered:**

- Go-to-definition, find-references, rename symbol — zero regression value for the target use case
- Code actions / quick fixes — same argument
- Formatting and linting integration

**Multi-file query environments:** queries operate on a single virtual file. Cross-file scenarios (module augmentation, declaration merging) are handled via `project.with({ files: {...} })`. True multi-file query environments — where you want a cursor in file A to reflect types contributed by file B written in the same test — are deferred to v2.

**Watch mode:** selenita is a test-time utility. Incremental watch support is v2+.

**Async query API:** the TS language service is synchronous. There is no async version of `getCompletionsAtPosition`. Forcing an async API surface would add `await` noise with no benefit. If a future TypeScript version introduces an async language service, selenita may expose an async path as an opt-in.

---

## 19. Phased Implementation Roadmap

Each phase has a clear, testable outcome. A phase is complete when its own tests pass and no prior-phase tests are broken.

### Phase 1 — Core Foundation ✅ Complete

_Outcome: a single-cursor query that returns completions and errors works end-to-end._

- ✅ TypeScript Language Service wrapper class (`SelenitaHost`)
  - ✅ Accepts a virtual file system (path → content map)
  - ✅ Resolves a `tsconfig.json` or uses sensible defaults
  - ✅ Exposes `getCompletionsAtPosition`, `getSemanticDiagnostics`, `getHoverInformation`
  - ✅ `resolveModuleNames` override for reliable virtual `node_modules` resolution
- ✅ `cursor` primitive — bare value and callable form
- ✅ `defineProject` with zero-config and `tsconfig` option
  - ✅ Auto-registers `beforeAll`/`afterAll` using test runner globals
  - ✅ Proxy-based deferred initialization (safe to call at module scope)
  - ✅ `project.ready()` escape hatch
- ✅ `project.query` tagged template — single unnamed cursor
  - ✅ Template parser: handles `cursor`, `snippet`, and `string` interpolations
  - ✅ Constructs virtual file, locates cursor position
  - ✅ Returns minimal result: `completions`, `errors`, `hover`
- ✅ `project.check` tagged template
  - ✅ Returns `errors`, `warnings`, `diagnostics`
- ✅ Integration test suite passing

### Phase 2 — Full Result Surface ✅ Complete

_Outcome: all result fields are populated; named cursors work; rich completion access works._

- ✅ Complete result interfaces — `signatureHelp`, `inlayHints`, `warnings`
- ✅ `completionItems`, `completionItem()`, `completionItemsOfKind()`
- ✅ String literal completions returned without surrounding quotes (clean DX)
- ✅ Named cursors in `project.query` — `cursor('name')` form
- ✅ `result.at('name')` for multi-cursor queries (results computed eagerly)
- ✅ `files` option in `defineProject` — virtual file injection
- ✅ Validation and error messages for all invalid cursor usage:
  - ✅ Bare `cursor` mixed with named `cursor('name')` in the same query
  - ✅ Duplicate cursor names within the same query
  - ✅ `cursor` used inside `project.check` template

### Phase 3 — Composition Primitives ✅ Complete

_Outcome: snippets and groups are defined and composable; cursor namespacing works correctly._

- ✅ `snippet` tagged template
  - ✅ Captures cursors at definition time
  - ✅ Expands inline when interpolated into a query or another snippet
  - ✅ `.for('alias')` scoping — inserts a path segment
- ✅ Nested snippet cursor namespacing — full path resolution with prefix concatenation
- ✅ `group([...])` and `group('label', [...])` primitives
- ✅ Validation for unnamed snippet in multi-use position — surfaced via the duplicate-cursor-name error, which includes the `.for('alias')` fix suggestion. A dedicated "snippet used without .for()" message is not needed; the duplicate-name path catches it correctly.

### Phase 4 — Group Queries & Parity ✅ Complete

_Outcome: `project.queryGroup` works; `hasParity` and `divergence` are correct._

- ✅ `project.queryGroup(group, factory)` curried template
  - ✅ Assembles virtual file from prelude + per-member generated calls
  - ✅ Auto-scopes cursors by API name
  - ✅ All per-member results computed eagerly before virtual file cleanup
- ✅ Group result shape — `result.for()`, `result.group.at()`
- ✅ `hasParity` — set-based comparison (order-insensitive)
- ✅ `divergence` — majority-baseline algorithm, `{ added, removed }` per member

### Phase 5 — Project Flexibility ✅ Complete

_Outcome: aliases, scoped overrides, and mode matrix all work._

- ✅ `aliases` option in `defineProject`
- ✅ `project.with({ aliases?, files? })` — clone with merge behavior; virtual files inherited from parent
- ✅ `project.forModes(modes, callback)` — string and object config shorthand
- ✅ `project.entry` on scoped mode project
- ✅ `dts` field support in mode config — injects `.d.ts` adjacent to compiled `.js` entry

### Phase 6 — Matcher Addon ✅ Complete

_Outcome: `selenita/vitest` is importable; all matchers work; type snapshots work._

- ✅ `selenita/vitest` entry point — side-effect import pattern
- ✅ All completion matchers (`toContainCompletion`, `toContainCompletions`, `toEqualCompletions`)
- ✅ All `CompletionItem` matchers (`toHaveKind`, `toHaveType`, `toHaveDocumentation`, `toBeDeprecated`)
- ✅ All diagnostic matchers (`toBeClean`, `toHaveError`, `toHaveErrorCount`)
- ✅ Parity matcher (`toHaveCompletionParity`)
- ✅ Signature help matchers (`toBeActiveOnParameter`, `toHaveParameterCount`)
- ✅ `toMatchTypeSnapshot()` — reads/writes snapshots to the `__type_snapshots__/` directory adjacent to the test file

### Phase 7 — Polish & Escape Hatches ✅ Complete

_Outcome: the library is production-ready; escape hatches are documented and usable._

- ✅ `project.languageService` escape hatch
- ✅ `project.virtualPath()` helper for resolving project-relative paths
- ✅ `project.positionOf(cursorName)` — raw character-offset helper (after a query has run)
- ✅ Comprehensive error messages across all invalid usage paths
- ✅ TypeScript type definitions for all public APIs — fully typed, no `any` in public surface
- ✅ TSDoc on all user-facing functions and configuration interfaces
- ✅ README and API reference documentation
- Performance benchmarks — deferred to a future release

---

## 20. Complete Real-World Example

This example demonstrates the full API surface together. It is designed to be readable without additional context — someone encountering this test file for the first time should understand what is being tested.

```ts
import { cursor, defineProject, group, snippet } from '@mszr/selenita'
import { describe, expect, it } from 'vitest'
import '@mszr/selenita/vitest'

// ─── project setup ─────────────────────────────────────────────────────────
// defineProject is called at module scope. Initialization (reading tsconfig,
// building the TS Program) happens automatically in a beforeAll.

const project = defineProject({
  tsconfig: './tsconfig.json',
  aliases: {
    '#fixtures/*': './tests/intellisense/fixtures/*',
  },
})

// ─── reusable building blocks ──────────────────────────────────────────────

const queryApis = group('queryApis', [
  'db.queryOnce',
  'db.queryOnceX',
  'db.useQuery',
  'db.useQueryX',
  'db.useInfiniteQuery',
])

const rootArg = snippet`{ workspaces: {}, ${cursor('root')} }`
const whereArg = snippet`{ status: 'open', ${cursor('where')} }`
const taskQuery = snippet`{ tasks: { where: ${whereArg} } }`

// ─── registerFruit ─────────────────────────────────────────────────────────

describe('registerFruit', () => {
  it('suggests all Fruit keys on empty object literal', () => {
    const { completions } = project.query`
      import { registerFruit } from './src'
      registerFruit({ ${cursor} })
    `
    expect(completions).toContainCompletions(['name', 'price', 'availableQuantity'])
    expect(completions).not.toContainCompletion('neim')
  })

  it('name is a non-deprecated string property with documentation', () => {
    const result = project.query`
      import { registerFruit } from './src'
      registerFruit({ ${cursor} })
    `
    expect(result.completionItem('name')).toHaveKind('property')
    expect(result.completionItem('name')).toHaveType('string')
    expect(result.completionItem('name')).toHaveDocumentation(/display name/)
    expect(result.completionItem('name')).not.toBeDeprecated()
  })

  it('hover on registerFruit shows full signature — type snapshot', () => {
    const { hover } = project.query`
      import { registerFruit } from './src'
      registerFruit${cursor}
    `
    expect(hover).toMatchTypeSnapshot()
  })

  it('no errors on valid input', () => {
    const { errors } = project.check`
      import { registerFruit } from './src'
      registerFruit({ name: 'apple', price: 5, availableQuantity: 100 })
    `
    expect(errors).toBeClean()
  })

  it('reports type error on unknown key', () => {
    const { errors } = project.check`
      import { registerFruit } from './src'
      registerFruit({ neim: 'apple' })
    `
    expect(errors).toHaveError(2353)
    expect(errors).toHaveError(/Object literal may only specify known properties/)
    expect(errors).toHaveErrorCount(1)
  })

  it('completions narrow as object is filled in', () => {
    const result = project.query`
      import { registerFruit } from './src'
      registerFruit({ ${cursor('empty')} })
      registerFruit({ name: 'apple', ${cursor('remaining')} })
    `
    expect(result.at('empty').completions).toContainCompletion('name')
    expect(result.at('remaining').completions).not.toContainCompletion('name')
    expect(result.at('remaining').completions).toContainCompletion('price')
  })
})

// ─── db query API surface ──────────────────────────────────────────────────

describe('db query API surface', () => {
  it('all query-like APIs expose identical root completions', () => {
    const result = project.queryGroup(queryApis, api => snippet`${api}(${rootArg})`)`
      import { db } from '#fixtures/query-surface'
    `

    expect(result.for('db.queryOnce').at('root').completions)
      .toContainCompletions(['workspaces', 'users', 'memberships'])

    expect(result.group.at('root')).toHaveCompletionParity()
  })

  it('where clause completions are consistent across all query APIs', () => {
    const result = project.queryGroup(queryApis, api => snippet`${api}(${taskQuery})`)`
      import { db } from '#fixtures/query-surface'
    `
    expect(result.group.at('where')).toHaveCompletionParity()
  })

  it('reusing a snippet at two call sites produces matching completions', () => {
    const result = project.query`
      import { db } from '#fixtures/query-surface'
      db.queryOnce(${whereArg.for('once')})
      db.useQuery(${whereArg.for('hook')})
    `
    expect(result.at('once.where').completions)
      .toEqualCompletions(result.at('hook.where').completions)
  })
})

// ─── dist output parity ─────────────────────────────────────────────────────
// Verify that type information survives compilation to CJS and ESM targets.

describe('dist output parity', () => {
  project.forModes(
    {
      'source': './src/index.ts',
      'dist-esm': { entry: './dist/index.js', dts: './dist/index.d.ts' },
      'dist-cjs': { entry: './dist/index.cjs', dts: './dist/index.d.ts' },
    },
    (project, mode) => {
      it(`[${mode}] registerFruit completions survive compilation`, () => {
        const { completions } = project.query`
          import { registerFruit } from '${project.entry}'
          registerFruit({ ${cursor} })
        `
        expect(completions).toContainCompletions(['name', 'price', 'availableQuantity'])
      })

      it(`[${mode}] no errors on valid registerFruit call`, () => {
        const { errors } = project.check`
          import { registerFruit } from '${project.entry}'
          registerFruit({ name: 'apple', price: 5, availableQuantity: 100 })
        `
        expect(errors).toBeClean()
      })
    }
  )
})

// ─── edge case: simulating a virtual type environment ──────────────────────

describe('hypothetical type environment', () => {
  const scoped = project.with({
    files: {
      'node_modules/hypothetical-lib/index.d.ts': `
        export declare function paint(color: Color): void
        export type Color = 'red' | 'green' | 'blue'
      `,
    },
  })

  it('completes string literal union members', () => {
    const { completions } = scoped.query`
      import { paint } from 'hypothetical-lib'
      paint(${cursor})
    `
    expect(completions).toEqualCompletions(['red', 'green', 'blue'])
  })
})
```

---

_End of specification. This document, together with the phased roadmap in §19, constitutes the complete blueprint for implementing selenita v1._
