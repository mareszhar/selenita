# Getting started

From install to a passing editor test in a few minutes, then the two ways to run selenita: inside Vitest, or from any script.

## 1. Install

```sh
pnpm add -D @mszr/selenita vitest   # or npm / bun / yarn
```

That is everything. selenita brings the TypeScript 6 language-service API it needs, so it installs and runs whether your project compiles with TypeScript 6 or TypeScript 7; its observations come from that TypeScript 6 service. Requirements: Node 22.12+ and, for the matchers, Vitest 5.

## 2. Your first test

```ts
// src/client.dx.test.ts
import { cursor, defineProject } from '@mszr/selenita/vitest'
import { expect, it } from 'vitest'

const project = defineProject()

it('suggests the query options', () => {
  const result = project.query`
    import { createQuery } from './src'
    createQuery({ ${cursor} })
  `
  expect(result).toSuggest(['table', 'limit', 'orderBy'])
})
```

Run it with `vitest`. What happened:

1. `defineProject()` found your `tsconfig.json` (walking up from the directory Vitest runs in) and registered hooks to build the TypeScript program before the suite and dispose of it after.
2. The template became a TypeScript file in your project root, so `./src` resolves exactly as it would for a file sitting there.
3. `cursor` marked where the user's caret is. selenita asked the language service what it suggests at that point.
4. `toSuggest` passed because all three names were offered. Had one been missing, the failure would show the fixture line, the cursor, and the names the editor did suggest.

Nothing else is required: no Vitest `globals`, no setup file, no type declarations to add. Importing from `@mszr/selenita/vitest` installs the matchers and their types.

## 3. A test per promise

Most editor tests check one of five promises — suggest, explain, report, guide, navigate. A taste of each:

```ts
import { cursor, defineProject } from '@mszr/selenita/vitest'
import { expect, it } from 'vitest'

const project = defineProject()

it('suggests only the routes that declare POST', () => {
  const result = project.query`
    import { api } from './src'
    api.post('${cursor}')
  `
  expect(result).toSuggestOnly(['/fruits', '/checkout'])
})

it('explains what createQuery is for', () => {
  const { hover } = project.query`
    import { createQuery } from './src'
    ${cursor}createQuery
  `
  expect(hover?.documentation).toMatch(/^Build a typed query/)
})

it('reports a misspelled option on the option itself', () => {
  const { errors } = project.check`
    import { createQuery } from './src'
    createQuery({ tabel: 'users' })
  `
  expect(errors).toHaveErrorCount(1)
  expect(errors).toHaveError(2561, /did you mean to write 'table'/i, { on: 'tabel' })
})

it('guides the second argument', () => {
  const { signatureHelp } = project.query`
    import { createQuery } from './src'
    createQuery({ table: 'users' }, ${cursor})
  `
  expect(signatureHelp?.activeParameterIndex).toBe(1)
  expect(signatureHelp?.activeParameter?.documentation).toContain('pagination')
})
```

The [promises guide](./promises.md) covers each in depth — including the assertions that look right but prove less than they seem.

## 4. Pointing at your project

`defineProject()` with no arguments is the common case. When you need more:

```ts
const project = defineProject({
  tsconfig: './tsconfig.test.json', // relative to where Vitest runs
  aliases: { '#fixtures/*': './tests/fixtures/*' },
  files: { 'generated/routes.d.ts': renderRouteTypes() },
  compilerOptions: { exactOptionalPropertyTypes: true },
})
```

Relative paths resolve from the working directory — the package Vitest runs in — so you do not need `import.meta.url` or `path.resolve`. The [projects guide](./projects.md) covers every option, plugins, performance, and testing source against built output.

Define each project once, at module or `describe` scope. A shared module is a good home when several test files use the same configuration:

```ts
// test-support/editor.ts
import { defineProject } from '@mszr/selenita/vitest'

export function editorProject() {
  return defineProject({ aliases: { '@test': './src/test-support/index.ts' } })
}
```

Call `editorProject()` at the top of each test file; every file gets its own isolated project.

## 5. Without Vitest

The core works in any script, benchmark, or other runner. `createProject` gives you a project you own:

```ts
import { createProject, cursor } from '@mszr/selenita'

using project = createProject({ tsconfig: './tsconfig.json' })

const { completionNames } = project.query`
  import { createQuery } from './src'
  createQuery({ ${cursor} })
`
console.log(completionNames)
```

`using` disposes the project at the end of the block. Without `using`, call `project.dispose()` when you are done. Results stay readable after disposal for everything you already read.

## What's next

- [Fixtures](./fixtures.md) — cursors, marks, snippets, scopes, and multi-file fixtures.
- [Testing the editor promises](./promises.md) — the cookbook.
- [Projects](./projects.md) — configuration, plugins, lifecycle, performance, testing kits.
- [API reference](../reference/api.md) and [matcher reference](../reference/matchers.md) — exact behavior.
