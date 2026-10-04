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
result.completionNames // what the editor suggests after typing `fruit.`
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
| Names are unique within a fixture. | `at(name)` must mean one place. Scope reused snippets with `.scope()`. |
| `project.check` takes no bare cursor. | `check` asks no questions at points, so an unnamed cursor could never be used. Named cursors and marks are fine: in a check they are locations. |
| `project.query` needs at least one cursor or mark. | A query asks somewhere; use `check` for diagnostics alone. |

## 2. Marks — what you point at

A mark names a piece of fixture text so you can refer to exactly that place later: where an error should be underlined, which identifiers a rename should touch.

```ts
import { mark } from '@mszr/selenita/vitest'

const result = project.check`
  declare function style(rule: { padding?: number }): void
  style({ ${mark('typo')`paddin`}: 8 })
`
expect(result.errors).toHaveError(2561, { on: result.rangeOf('typo') })
```

`result.rangeOf('typo')` returns a [range](../reference/api.md#range): the file, start, end, and text of the mark. Ranges compare with `toEqual`, so a mark is also how you state expected locations for rename and fixes.

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
result.rangeOf('brand') // where `brand` is
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
result.at('where').completionNames
```

**Scopes keep reused names unique.** `.scope(name)` prefixes every marker inside the snippet:

```ts
const result = project.query`
  import { db } from './src'
  db.findMany(${where.scope('many')})
  db.findOne(${where.scope('one')})
`
expect(result.at('many.where')).toSuggestOnly(result.at('one.where').completionNames)
```

Scopes nest from the outside in, so every name reads like a path you can trace by eye:

```ts
const inner = snippet`{ ${cursor('field')} }`
const outer = snippet`{ nested: ${inner.scope('inner')} }`

project.query`api(${outer.scope('ctx')})` // → result.at('ctx.inner.field')
```

## 5. Arrays — fan-out

An interpolated array is joined in order, **with nothing between elements** — exactly like the rest of the template. Map data to snippets and the fixture builds itself; start each element with `\n` (or end it with `;`) so the elements become separate statements:

```ts
const factories = ['defineVerb', 'defineSubject', 'defineGate'] as const

const result = project.query`
  import { ${factories.join(', ')} } from './src'
  ${factories.map(name => snippet`\n${name}({ ${cursor(name)} })`)}
`
for (const name of factories)
  expect(result.at(name)).toSuggest('description')
```

Forgetting the boundary produces `defineVerb({ })defineSubject({ })` — a syntax error the editor may still offer completions around. `result.errors` will show it; `toBeClean()` on a fan-out fixture is a cheap guard.

When each element carries the same marker names, scope each element. `result.atEach(name, scopes)` then gathers that cursor from every listed scope — the shape parity assertions expect:

```ts
const dbs = ['officialDb', 'baselineDb'] as const

const result = project.query`
  ${setup}
  ${dbs.map(db => snippet`\n${db}.useQuery({ ${cursor('root')} })`.scope(db))}
`
expect(result.atEach('root', dbs)).toHaveCompletionParity()
```

`atEach('root', dbs)` returns `{ officialDb: …, baselineDb: … }`, and throws if a listed scope has no `root` cursor — so a member that lost its cursor fails loudly instead of quietly dropping out of the comparison. Without the list, `atEach('root')` returns every scope that has one.

**Scopes namespace markers, not code.** When elements declare the same local names, give each its own block:

```ts
const result = project.query`
  ${cases.map(c => snippet`\n{
    const api = ${c.factory}
    api.${cursor('members')}
  }`.scope(c.name))}
`
```

## 6. Several files

Pass a record instead of a template when the scenario spans files, when the file name matters (`.tsx`, `.mts`, `*.css.ts`), or when an import must be relative to a specific folder:

```ts
const result = project.query({
  'colors.ts': snippet`
    export const colors = { ${mark('definition')`brand`}: '#635bff' }
  `,
  'consumer.ts': snippet`
    import { colors } from './colors'
    void colors.${mark('use')`brand`}
  `,
})

expect(result.at('use').rename.locations).toEqual([
  result.rangeOf('definition'),
  result.rangeOf('use'),
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
