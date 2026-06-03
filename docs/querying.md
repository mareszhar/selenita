# Querying

## `project.query` — language service at a cursor

`project.query` takes a tagged template with one or more cursor interpolations and returns language service data at those positions.

### Single cursor

```ts
const result = project.query`
  import { createQuery } from 'my-api'
  createQuery({ ${cursor} })
`

result.completions // string[] — completion names
result.completionItems // CompletionItem[]
result.completionItem('table') // CompletionItem | undefined
result.completionItemsOfKind('property') // CompletionItem[]
result.hover // string | null
result.signatureHelp // SignatureHelp | null
result.inlayHints // InlayHint[]
result.diagnostics // Diagnostic[]
result.errors // Diagnostic[] — severity === 'error'
result.warnings // Diagnostic[] — severity === 'warning'
```

### Named cursors — multiple positions in one query

When a query contains more than one cursor, every cursor must be named. Use `result.at()` to access each position's data:

```ts
const result = project.query`
  import { createQuery } from 'my-api'
  createQuery({ ${cursor('empty')} })
  createQuery({ table: 'users', ${cursor('partial')} })
`

result.at('empty').completions // all QueryOptions keys
result.at('partial').completions // remaining keys not yet filled
result.diagnostics // file-wide diagnostics
```

Validation rules:

- Bare `cursor` and `cursor('name')` cannot coexist in the same query.
- Every cursor name must be unique within a query. Reused snippets must be scoped with `.for('alias')` — see [Snippets](./snippets.md).

---

## `project.check` — diagnostics only

No cursor needed. Returns type errors, warnings, and inlay hints for the whole virtual file.

```ts
const { errors } = project.check`
  import { createQuery } from 'my-api'
  createQuery({ tabel: 'users' })
`

errors.length // > 0
errors[0]?.code // TypeScript error code, e.g. 2353
errors[0]?.message // human-readable message
```

---

## Result shapes

### `CompletionItem`

| Field | Type | Notes |
| --- | --- | --- |
| `name` | `string` | |
| `kind` | `CompletionItemKind` | `'property'`, `'method'`, `'variable'`, `'keyword'`, etc. |
| `type` | `string` | Full display string, e.g. `"(property) QueryOptions.table: string"` |
| `documentation` | `string` | JSDoc text; empty string if none |
| `isDeprecated` | `boolean` | |
| `isOptional` | `boolean` | |
| `isRecommended` | `boolean` | True when the TS language service marks the entry recommended |

String literal completions have their quotes stripped — `'asc' | 'desc'` yields `['asc', 'desc']`, not `["'asc'", "'desc'"]`.

### `Diagnostic`

| Field | Type | Notes |
| --- | --- | --- |
| `message` | `string` | |
| `code` | `number` | TypeScript error code, e.g. `2339` |
| `severity` | `'error' \| 'warning' \| 'suggestion'` | |
| `line` | `number` | 1-indexed |
| `column` | `number` | 1-indexed |

Diagnostics are scoped to the **virtual file** — the code you wrote in the template literal. Errors inside files you import do not appear unless the import itself fails. Your IntelliSense tests stay isolated from the state of your source files.

### `SignatureHelp`

```ts
interface SignatureHelp {
  signatures: Array<{
    label: string // e.g. "createQuery(opts: QueryOptions): void"
    documentation: string
    parameters: Array<{ label: string, documentation: string }>
  }>
  activeSignature: number // zero-indexed
  activeParameter: number // zero-indexed
}
```

### `InlayHint`

```ts
interface InlayHint {
  text: string // e.g. "table:", ": string"
  kind: 'parameter' | 'type' | 'enum'
  line: number // 1-indexed
  column: number // 1-indexed
}
```
