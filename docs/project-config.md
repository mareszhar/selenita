# Project Configuration

## `project.with()` — scoped overrides

Create an immutable clone of a project with additional or overriding configuration. The parent is not modified.

`aliases` and `files` from the parent are inherited and merged. Conflicting keys are overridden by the new values.

```ts
// Inject a virtual package
const scoped = project.with({
  files: {
    'node_modules/hypothetical-api/index.d.ts': `
      export declare function frobnicate(x: 'a' | 'b' | 'c'): void
    `,
  },
})

const { completions } = scoped.query`
  import { frobnicate } from 'hypothetical-api'
  frobnicate(${cursor})
`
completions // ['a', 'b', 'c']
```

**Chaining:**

```ts
const base = project.with({ files: { 'node_modules/lib-a/index.d.ts': '...' } })
const extended = base.with({ files: { 'node_modules/lib-b/index.d.ts': '...' } })
// extended sees both lib-a and lib-b
```

---

## `project.forModes()` — mode matrix

Verify that type information survives compilation to your distribution targets. The callback runs once per mode. Each mode's scoped `project` exposes `project.entry` — the resolved path to that mode's entry file — for interpolation into query templates.

```ts
project.forModes(
  {
    'source': './src/index.ts',
    'dist-esm': { entry: './dist/index.js', dts: './dist/index.d.ts' },
    'dist-cjs': { entry: './dist/index.cjs', dts: './dist/index.d.ts' },
  },
  (project, mode) => {
    it(`[${mode}] suggests QueryOptions keys`, () => {
      const { completions } = project.query`
        import { createQuery } from '${project.entry}'
        createQuery({ ${cursor} })
      `
      expect(completions).toContain('table')
    })
  }
)
```

The `dts` field is required when the entry is a compiled file without embedded type declarations. selenita injects the declaration file adjacent to the entry so TypeScript can find it, using the correct extension pairing: `.js` → `.d.ts`, `.cjs` → `.d.cts`, `.mjs` → `.d.mts`.

**Mode config shorthand:** a plain string is treated as `{ entry: '...' }` with no `dts`.

---

## Error handling contract

selenita never throws when encountering invalid TypeScript — results are always safe to assert against.

| Situation | Behavior |
| --- | --- |
| Cursor in a position with no completions | `completions = []`, `hover = null` |
| `completionItem('nonexistent')` | Returns `undefined` |
| Code with parse errors | Errors appear in `result.errors`; other fields hold what TS could partially infer |
| Bare `cursor` mixed with `cursor('name')` in the same query | Throws with a clear message pointing to the fix |
| Duplicate cursor names | Throws with the duplicate name and a fix suggestion |
| Bare `cursor` inside `project.check` | Throws — use `project.query` instead |
| Snippet with cursors inside `project.check` | Only the code text is used — cursor positions are silently discarded |
| Snippet at multiple positions without `.for()` | Throws with a fix suggestion |

---

## Escape hatch — `project.languageService`

Access the raw TypeScript `LanguageService` when selenita's API doesn't cover your case:

```ts
const ls = project.languageService // ts.LanguageService
const file = project.lastVirtualFileName // path of the most recent query's virtual file
const pos = project.positionOf('cursorName') // character offset of a named cursor

// After running a query, call any LS method directly
const defs = ls.getDefinitionAtPosition(file!, pos!)
```

`positionOf()` and `lastVirtualFileName` reflect the most recently executed `project.query` call.
