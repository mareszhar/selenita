# Fixtures

A fixture is the code your user would write, with markers where you want to ask the editor something. This guide covers every way to build one — from a single cursor to several files assembled from reusable snippets.

```text
project.query`
  import { api } from './src'          ← ordinary TypeScript
  api.${cursor('verbs')}               ← a cursor: ask here
  api.post({ ${mark('key')`bdy`}: 1 }) ← a mark: locate this text
`
```

## 1. Cursors — where you ask

A cursor sits between two characters, exactly like the editor's caret. Observations at a cursor are what the editor shows when the caret is there.

```ts
const result = project.query`
  import { fruit } from './src'
  fruit.${cursor}
`
result.completions // what the editor suggests after typing `fruit.`
```

**One cursor** can be bare. Read its observations directly from the result.

**Several cursors** must be named. Read each with `result.at(name)`:

```ts
const result = project.query`
  import { createQuery } from './src'
  createQuery({ ${cursor('empty')} })
  createQuery({ table: 'users', ${cursor('partial')} })
`
expect(result.at('empty')).toSuggest('table')
expect(result.at('partial')).not.toSuggest('table')
```

Marker names autocomplete inside `at('…')`, and a misspelled name is a type error.

**Hovering a word**: put the cursor at the start of the identifier. That is where the editor's hover target begins.

```ts
const { hover } = project.query`
  import { createQuery } from './src'
  ${cursor}createQuery({ table: 'users' })
`
```

Rules, each enforced with an error that names the fix:

| Rule | Why |
| --- | --- |
| A bare cursor must be the only cursor. | Bare means "the one"; two would be ambiguous. |
| Names are unique within a fixture. | `at(name)` must mean one place. Scope reused snippets with `.for()`. |
| `project.check` takes no cursors. | `check` reports diagnostics; use `query` to ask at a point, or `mark` to locate text. |
| `project.query` needs at least one cursor or mark. | A query asks somewhere; use `check` for diagnostics alone. |

## 2. Marks — what you point at

A mark names a piece of fixture text so you can refer to exactly that place later: where an error should be underlined, which identifiers a rename should touch.

```ts
import { mark } from '@mszr/selenita/vitest'

const result = project.check`
  declare function style(rule: { padding?: number }): void
  style({ ${mark('typo')`paddin`}: 8 })
`
expect(result.errors).toHaveError(2561, { on: result.range('typo') })
```

`result.range('typo')` returns a [range](../reference/api.md#range): the file, start, end, and text of the mark. Ranges compare with `toEqual`, so a mark is also how you state expected locations for rename and fixes.

Marks can contain anything a fixture can — including cursors:

```ts
const result = project.query`
  import { colors } from './colors'
  void colors.${mark('use')`${cursor('caret')}brand`}
`
```

A mark is also observable **at its start**, which saves a cursor when you want to ask about the marked word itself:

```ts
const result = project.query`
  import { tokens } from './tokens'
  void tokens.${mark('brand')`brand`}
`
result.at('brand').hover // hover over `brand`
result.range('brand') // where `brand` is
```

When the text is unique in the fixture, you often need no mark at all: `{ on: 'paddin' }` locates an error by the text it underlines. Reach for a mark when the same text appears more than once, or when you compare locations across files.

## 3. Strings — plain source

Interpolated strings become fixture text. They are the simplest way to share setup that has no markers:

```ts
const setup = `
  import { createClient } from './src'
  const api = createClient()
`

project.query`
  ${setup}
  api.${cursor}
`
```

## 4. Snippets — reusable source with markers

A snippet is a fragment that carries its own markers. It is inert until interpolated into a query, a check, or another snippet.

```ts
import { cursor, snippet } from '@mszr/selenita/vitest'

const where = snippet`{ status: 'open', ${cursor('where')} }`

const result = project.query`
  import { db } from './src'
  db.findMany(${where})
`
result.at('where').completions
```

**Scopes keep reused names unique.** `.for(scope)` prefixes every marker inside the snippet:

```ts
const result = project.query`
  import { db } from './src'
  db.findMany(${where.for('many')})
  db.findOne(${where.for('one')})
`
expect(result.at('many.where')).toSuggestOnly(result.at('one.where').completions)
```

Scopes nest from the outside in, so every name reads like a path you can trace by eye:

```ts
const inner = snippet`{ ${cursor('field')} }`
const outer = snippet`{ nested: ${inner.for('inner')} }`

project.query`api(${outer.for('ctx')})` // → result.at('ctx.inner.field')
```

## 5. Arrays — fan-out

An interpolated array is joined in order. Map data to snippets and the fixture builds itself:

```ts
const factories = ['defineVerb', 'defineSubject', 'defineGate'] as const

const result = project.query`
  import { ${factories.join(', ')} } from './src'
  ${factories.map(name => snippet`\n${name}({ ${cursor(name)} })`)}
`
for (const name of factories)
  expect(result.at(name)).toSuggest('description')
```

When each element carries the same marker names, scope each element. `result.across(name)` then gathers that cursor from every scope — the shape parity assertions expect:

```ts
const dbs = ['officialDb', 'baselineDb'] as const

const result = project.query`
  ${setup}
  ${dbs.map(db => snippet`${db}.useQuery({ ${cursor('root')} })`.for(db))}
`
expect(result.across('root')).toHaveCompletionParity()
```

`across('root')` returns `{ officialDb: …, baselineDb: … }`: one entry per scope that contains a cursor named `root`.

## 6. Several files

Pass a record instead of a template when the scenario spans files, when the file name matters (`.tsx`, `.mts`, `*.css.ts`), or when an import must be relative to a specific folder:

```ts
const result = project.query({
  'colors.ts': snippet`
    import { defineTokens } from '@mszr/vanity'
    export const colors = defineTokens({ color: { ${mark('definition')`brand`}: '#635bff' } })
  `,
  'consumer.ts': snippet`
    import { colors } from './colors'
    void colors.color.${mark('use')`brand`}
  `,
})

expect(result.at('use').rename.locations).toEqual([
  result.range('definition'),
  result.range('use'),
])
```

- **Paths resolve from the project root**, so `'src/view.tsx'` lives beside your real `src/` files and `./widget` imports the real `src/widget.ts`.
- **The extension is the context.** `.tsx` enables JSX, `.mts` and `.cts` select the ES module or CommonJS interpretation under `NodeNext`, `.d.ts` is a declaration file.
- **A fixture file may overlay a real file** with the same path. For that query only, the editor sees your version — handy for "what if this file contained…". Pick a fresh name when you want no overlap.
- **Marker names are unique across all files.** Ranges carry their `file`, so you never need a per-file namespace.
- **Diagnostics cover every fixture file.** Each diagnostic's `range.file` says where.

The template form is the same thing with one anonymous file, `__selenita__.ts`, in the project root.

## 7. What the editor sees

selenita joins the template exactly as written: indentation, blank lines, and all. Lines and columns are 1-based; offsets count UTF-16 code units, like TypeScript. `result.files` holds the flattened source of every fixture file, which is useful when an assertion surprises you:

```ts
console.log(result.files['__selenita__.ts'])
```

Interpolations accept strings, cursors, marks, snippets, and arrays of those. Anything else is an error, because a number or object would silently become `[object Object]` in your fixture.

## 8. Fixtures and isolation

Each query sees only its own fixture. Declarations, globals, and module augmentations from one query never leak into the next — so a fixture may freely `declare module` to register types, as a real user's project would.

Reading an observation later is safe, too. If another query ran in between, selenita briefly restores the fixture the result came from, so a result always describes its own source.
