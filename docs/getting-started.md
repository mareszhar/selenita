# Getting Started

## Installation

```sh
# npm
npm install --save-dev @mszr/selenita typescript

# bun
bun add --dev @mszr/selenita typescript

# pnpm
pnpm add --save-dev @mszr/selenita typescript
```

`typescript` is a peer dependency — version `>=6.0.0` is required.

---

## Connecting to your project

`defineProject` creates the test handle. Call it at **module scope** or at the top of a `describe` block — never inside a `test`. It auto-registers `beforeAll`/`afterAll` for the TypeScript program's lifecycle.

> **Vitest users:** selenita uses `globalThis.beforeAll` / `globalThis.afterAll` for lifecycle auto-registration, which requires Vitest's `globals` option. Add `globals: true` to your Vitest config:
>
> ```ts
> // vitest.config.ts
> export default defineConfig({
>   test: { globals: true }
> })
> ```

```ts
import { cursor, defineProject } from '@mszr/selenita'
import { describe, expect, it } from 'vitest'

// Auto-detects the nearest tsconfig.json, walking up from process.cwd()
const project = defineProject()

// Or point to a specific tsconfig:
// const project = defineProject({ tsconfig: './tsconfig.json' })
```

### Injecting virtual type declarations

When you want to test against type declarations that don't exist as real files — simulating an installed package, a hypothetical API, or a fixture — inject them as virtual files. They exist only in selenita's language-service session and never touch disk.

```ts
const project = defineProject({
  tsconfig: './tsconfig.json',
  files: {
    'node_modules/my-api/index.d.ts': `
      export declare function createQuery(opts: QueryOptions): void
      export interface QueryOptions {
        table: string
        limit?: number
        orderBy?: 'asc' | 'desc'
      }
    `,
  },
})
```

### Path aliases

Follows the same convention as tsconfig `paths`:

```ts
const project = defineProject({
  tsconfig: './tsconfig.json',
  aliases: {
    '#fixtures/*': './tests/fixtures/*',
    '#mocks': './tests/mocks/index',
  },
})
```

---

## Your first test

```ts
it('suggests QueryOptions keys', () => {
  const { completions } = project.query`
    import { createQuery } from 'my-api'
    createQuery({ ${cursor} })
  `
  expect(completions).toContain('table')
  expect(completions).toContain('limit')
  expect(completions).toContain('orderBy')
})
```

The `cursor` marks where you want language service data. The template becomes a virtual TypeScript file; selenita queries the TypeScript Language Service at that position.

---

## Setting up the optional matchers

The `@mszr/selenita/vitest` addon extends `expect` with completions-, diagnostics-, and parity-specific matchers. Add it once to your setup file:

```ts
// vitest.setup.ts
import '@mszr/selenita/vitest'
```

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { setupFiles: ['./vitest.setup.ts'] },
})
```

---

## What's next

- [Querying completions, hover, and diagnostics](./querying.md)
- [Snippets and multi-position queries](./snippets.md)
- [Testing API parity with groups](./groups.md)
- [Scoped overrides and mode matrix](./project-config.md)
- [Custom matchers reference](./matchers.md)
