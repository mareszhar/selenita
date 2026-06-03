# Snippets

A snippet is a reusable code fragment that captures its cursors at definition time. It's inert until interpolated into a query or another snippet.

## Defining a snippet

```ts
import { cursor, snippet } from '@mszr/selenita'

const filterArg = snippet`{ status: 'open', ${cursor('filter')} }`
```

## Single use — no scoping needed

```ts
const result = project.query`
  import { db } from './src'
  db.findMany(${filterArg})
`
result.at('filter').completions
```

## Multiple uses — scope with `.for()`

When the same snippet appears more than once in a query, scope each use with `.for('alias')` to keep cursor names unique. The alias becomes a prefix in the cursor path.

```ts
const result = project.query`
  import { db } from './src'
  db.findMany(${filterArg.for('list')})
  db.findOne(${filterArg.for('single')})
`

result.at('list.filter').completions
result.at('single.filter').completions
```

## Composition

Snippets can embed other snippets. The cursor path is built by concatenating all `.for()` segments from outermost to innermost:

```ts
const inner = snippet`{ ${cursor('field')} }`
const outer = snippet`{ nested: ${inner.for('inner')} }`

// Unscoped outer — cursor path is 'inner.field'
project.query`someApi(${outer})`
// → result.at('inner.field')

// Scoped outer — path is 'ctx.inner.field'
project.query`someApi(${outer.for('ctx')})`
// → result.at('ctx.inner.field')
```

The full path is always readable by scanning the `.for()` calls in order — no hidden naming.

## Passing multiple arguments

```ts
const filterArg = snippet`{ status: 'open', ${cursor('filter')} }`
const optionsArg = snippet`{ orderBy: 'createdAt' }`

const result = project.query`
  import { db } from './src'
  db.findMany(${filterArg}, ${optionsArg})
`
result.at('filter').completions
```

## Snippets in groups

Snippets are the primary building block for `project.queryGroup`. See [Groups & Parity](./groups.md).
