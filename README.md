# selenita

> The best libraries are not only type-safe; they provide great IntelliSense. But testing IntelliSense is so cumbersome it's often ignored. **selenita** makes it delightful.

selenita exposes the TypeScript Language Service through a tagged-template API. Write completions, hover, and diagnostics assertions the same way you write any other test — no line/column arithmetic, no magic comment strings, no separate DSL.

---

## Why test IntelliSense?

Type safety is not the whole story. When someone uses your library, TypeScript's language service is an invisible co-author — suggesting properties, flagging mistakes, explaining what each parameter means. That experience is part of your API surface.

A refactor that renames an option, changes the order of union members, or introduces a new required field can break completions silently. No runtime error. No failing test. Just a quietly degraded experience for anyone using your library.

selenita gives that surface the same regression protection you give your runtime behavior. If a completion disappears, an unexpected error appears, or two equivalent APIs start diverging — your tests catch it before your users do.

---

## Highlights

- **✨ Zero arithmetic** — cursors are first-class JavaScript values you interpolate directly; no line numbers, no character offsets.
- **🧩 Composable** — `snippet` captures reusable code fragments with their own cursors; `.for('alias')` scopes them for multi-position use.
- **🔬 Parity testing** — `group` + `queryGroup` assert that a set of APIs expose identical completions, and surface exactly what diverges when they don't.
- **📦 Mode matrix** — `forModes` runs your tests against source, `dist-esm`, and `dist-cjs` in one declaration.
- **🏃 Synchronous** — the TypeScript Language Service is synchronous. No forced `await`, no async test boilerplate.
- **🔒 Isolated** — each test file gets its own TypeScript program. Standard concurrent mode works with zero configuration.
- **🛡️ Safe by design** — invalid positions return empty results, never throw. Errors only come from programming mistakes.
- **🪝 Extensible** — plain object results work with any `expect`. Vitest matcher addon for the best ergonomics.

---

## Quick start

```sh
bun add --dev @mszr/selenita typescript   # or npm / pnpm
```

selenita uses `globalThis.beforeAll`/`afterAll` for lifecycle registration. Enable Vitest globals in your config:

```ts
// vitest.config.ts
export default defineConfig({ test: { globals: true } })
```

```ts
import { cursor, defineProject } from '@mszr/selenita'
import { describe, expect, it } from 'vitest'

const project = defineProject({ tsconfig: './tsconfig.json' })

describe('createQuery', () => {
  it('suggests option keys', () => {
    const { completions } = project.query`
      import { createQuery } from './src'
      createQuery({ ${cursor} })
    `
    expect(completions).toContain('table')
    expect(completions).toContain('limit')
  })

  it('flags unknown options as errors', () => {
    const { errors } = project.check`
      import { createQuery } from './src'
      createQuery({ tabel: 'users' })
    `
    expect(errors.length).toBeGreaterThan(0)
  })
})
```

---

## Complete example

```ts
import { cursor, defineProject, group, snippet } from '@mszr/selenita'
import { describe, expect, it } from 'vitest'
import '@mszr/selenita/vitest'

const project = defineProject({
  tsconfig: './tsconfig.json',
  aliases: { '#fixtures/*': './tests/fixtures/*' },
})

const queryApis = group('queryApis', ['db.findMany', 'db.findOne', 'db.aggregate'])
const filterArg = snippet`{ status: 'open', ${cursor('filter')} }`

// ─── option completions ───────────────────────────────────────────

describe('createQuery', () => {
  it('suggests all options', () => {
    const { completions } = project.query`
      import { createQuery } from './src'
      createQuery({ ${cursor} })
    `
    expect(completions).toContainCompletions(['table', 'limit', 'orderBy'])
    expect(completions).not.toContainCompletion('tabel')
  })

  it('table is a required string property', () => {
    const result = project.query`
      import { createQuery } from './src'
      createQuery({ ${cursor} })
    `
    expect(result.completionItem('table')).toHaveKind('property')
    expect(result.completionItem('table')).toHaveType('string')
    expect(result.completionItem('table')).not.toBeDeprecated()
  })

  it('completions narrow as options fill in', () => {
    const result = project.query`
      import { createQuery } from './src'
      createQuery({ ${cursor('empty')} })
      createQuery({ table: 'users', ${cursor('partial')} })
    `
    expect(result.at('empty').completions).toContainCompletion('table')
    expect(result.at('partial').completions).not.toContainCompletion('table')
  })
})

// ─── API parity ───────────────────────────────────────────────────

describe('query API parity', () => {
  it('all query methods expose identical filter completions', () => {
    const result = project.queryGroup(queryApis, api => snippet`${api}(${filterArg})`)`
      import { db } from '#fixtures/db'
    `
    expect(result.group.at('filter')).toHaveCompletionParity()
  })
})

// ─── dist output ─────────────────────────────────────────────────

describe('dist output', () => {
  project.forModes(
    {
      'source': './src/index.ts',
      'dist-esm': { entry: './dist/index.js', dts: './dist/index.d.ts' },
    },
    (project, mode) => {
      it(`[${mode}] completions survive compilation`, () => {
        const { completions } = project.query`
          import { createQuery } from '${project.entry}'
          createQuery({ ${cursor} })
        `
        expect(completions).toContainCompletion('table')
      })
    }
  )
})
```

---

## Documentation

| | |
| --- | --- |
| **[Getting started](https://github.com/mareszhar/selenita/blob/main/docs/getting-started.md)** [[get raw]](https://raw.githubusercontent.com/mareszhar/selenita/main/docs/getting-started.md) | Installation, project setup, connecting to your tsconfig |
| **[Querying](https://github.com/mareszhar/selenita/blob/main/docs/querying.md)** [[get raw]](https://raw.githubusercontent.com/mareszhar/selenita/main/docs/querying.md) | `project.query`, `project.check`, all result shapes |
| **[Snippets](https://github.com/mareszhar/selenita/blob/main/docs/snippets.md)** [[get raw]](https://raw.githubusercontent.com/mareszhar/selenita/main/docs/snippets.md) | Reusable fragments, `.for()` scoping, composition |
| **[Groups & parity](https://github.com/mareszhar/selenita/blob/main/docs/groups.md)** [[get raw]](https://raw.githubusercontent.com/mareszhar/selenita/main/docs/groups.md) | `group`, `project.queryGroup`, `hasParity`, `divergence` |
| **[Project config](https://github.com/mareszhar/selenita/blob/main/docs/project-config.md)** [[get raw]](https://raw.githubusercontent.com/mareszhar/selenita/main/docs/project-config.md) | `project.with()`, `project.forModes()`, escape hatches |
| **[Matchers](https://github.com/mareszhar/selenita/blob/main/docs/matchers.md)** [[get raw]](https://raw.githubusercontent.com/mareszhar/selenita/main/docs/matchers.md) | All custom Vitest matchers with examples |
| | |
