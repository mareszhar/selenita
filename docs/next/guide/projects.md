# Projects

A project is the TypeScript environment your fixtures run in — configured to match what your users have in their editor. This guide covers configuration, plugins, lifecycle, recipes for common setups, and performance.

## 1. Configuration at a glance

```ts
const project = defineProject({
  tsconfig: './tsconfig.json', // default: nearest tsconfig.json
  compilerOptions: { exactOptionalPropertyTypes: true }, // tsconfig.json spelling
  files: { 'types/env.d.ts': 'declare const __DEV__: boolean' },
  aliases: { '#fixtures/*': './tests/fixtures/*' },
  plugins: [myLanguageServicePlugin],
})
```

| Option | Default | Purpose |
| --- | --- | --- |
| `tsconfig` | nearest `tsconfig.json`, walking up from the working directory | Which compiler options and root files your users have. `false` for an isolated in-memory setup. |
| `compilerOptions` | none | Adjust options in tsconfig.json spelling. Applied over the tsconfig. |
| `files` | none | Virtual files that exist for the project's lifetime, e.g. generated declarations. |
| `aliases` | none | Import specifiers mapped to paths, like tsconfig `paths`. |
| `plugins` | none | TypeScript language-service plugins to load, as tsserver would. |

Every option is validated when the project is created. A misspelled option or a tsconfig path that does not exist throws immediately, naming the problem.

**Paths resolve from the working directory** — the package Vitest runs in. Write `'./tsconfig.json'`, not `resolve(import.meta.dirname, …)`. The **project root** is the tsconfig's directory (the working directory when `tsconfig: false`); fixture files and `files` keys resolve from it.

## 2. tsconfig and compilerOptions

Point selenita at the tsconfig your users' editors would load for the code under test. Root files listed by its `include`/`files` are part of the program, so ambient declarations and module augmentations they contain apply to every fixture.

`tsconfig: false` gives a strict, self-contained environment (ES2022, ESNext modules, `Bundler` resolution, strict) — useful for microfixtures and for tools that test TypeScript behavior itself.

`compilerOptions` uses the spelling you would write in tsconfig.json, and IntelliSense completes the option names:

```ts
defineProject({
  compilerOptions: {
    module: 'nodenext',
    moduleResolution: 'nodenext',
    allowImportingTsExtensions: true,
  },
})
```

Precedence, from weakest to strongest: tsconfig → `compilerOptions` → `aliases` (merged into `paths`).

## 3. Virtual files

`files` adds files that live only in selenita's view of the project, for the project's whole lifetime. Use them for generated declarations, environment shims, or a module your fixtures import:

```ts
const project = defineProject({
  files: {
    '.kit/system.ts': `export { ds } from './src/system'`,
  },
  aliases: { '#kit/system': './.kit/system.ts' },
})

project.query`
  import { ds } from '#kit/system'
  ds.${cursor}
`
```

Fixture files (from `query`/`check`) and project files are the same kind of thing with different lifetimes: project files last as long as the project, fixture files as long as one query.

### Simulating an installed package

Module resolution is TypeScript's own, so a virtual package must look like a real one — a `package.json` and its declarations. That way an `exports` map restricts subpaths exactly as it would for your users:

```ts
const project = defineProject({
  files: {
    'node_modules/fruit-lib/package.json': JSON.stringify({
      name: 'fruit-lib',
      exports: { '.': { types: './index.d.ts' } },
    }),
    'node_modules/fruit-lib/index.d.ts': `export declare function pick(name: 'apple' | 'kiwi'): void`,
  },
})
```

When you only need a declaration shape, skip the package and alias it:

```ts
const project = defineProject({
  files: { 'fixtures/fruit.d.ts': `export declare function pick(name: 'apple' | 'kiwi'): void` },
  aliases: { 'fruit-lib': './fixtures/fruit.d.ts' },
})
```

## 4. Plugins

Language-service plugins change what the editor reports: extra diagnostics, rename across custom identities, quick fixes. selenita loads them exactly as tsserver does — pass the plugin module's factory:

```ts
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const project = defineProject({
  plugins: [require('./typescript-plugin.cjs')],
})
```

Give a plugin the options it would read from its tsconfig entry by pairing it with them:

```ts
defineProject({
  plugins: [[require('./typescript-plugin.cjs'), { authoringBarrels: ['./src/authoring.ts'] }]],
})
```

A plugin factory receives `{ typescript }` — the same TypeScript instance selenita uses — and returns `{ create(info) }`. selenita calls `create` once per project, before any observation, and every observation goes through the returned service.

`info` provides `languageService`, `languageServiceHost`, `config`, and a minimal `project` with `getCurrentDirectory()`, `getCompilerOptions()`, and a no-op `projectService.logger`. Two boundaries to know: a plugin that reads files with `node:fs` sees the disk, not selenita's virtual files; and a plugin that needs a full tsserver session is outside what a test can faithfully provide — test those in the editor.

A plugin written inline is just as valid, which makes service decoration a one-liner:

```ts
defineProject({
  plugins: [() => ({ create: info => withLogging(info.languageService) })],
})
```

## 5. Lifecycle

| | `defineProject` (from `/vitest`) | `createProject` (core) |
| --- | --- | --- |
| Use in | Vitest test files, at module or `describe` scope | Scripts, benchmarks, other runners, inside a test |
| Builds the program | in `beforeAll` | on first use, or `warmup()` |
| Disposes | in `afterAll` | `dispose()`, or `using` |
| Matchers | installed by importing `/vitest` | not installed |

```ts
// Inside a single test: own it with `using`
it('reports the missing peer in an isolated environment', () => {
  using project = createProject({ tsconfig: false, files: { 'env.d.ts': 'declare const peer: never' } })
  expect(project.check`peer.connect()`.errors).toHaveErrorCount(1)
})
```

Rules worth knowing:

- Creating a project is cheap; the TypeScript program is built on the first observation (or by `warmup()`, which `defineProject` calls in `beforeAll` so the cost lands in the hook rather than the first test).
- `dispose()` is idempotent. Querying a disposed project throws.
- Everything you already read from a result stays readable after disposal. Reading an observation for the first time after disposal throws, naming the observation.
- `defineProject` called inside a running test throws with a hint to use `createProject` with `using`.

### Variations of a project

A project's configuration is a plain object, so variations are object spreads:

```ts
const base = { aliases: { '@test': './src/test-support/index.ts' } }

const project = defineProject(base)
const nuxtProject = defineProject({ ...base, files: { 'nuxt-config.d.ts': renderNuxtTypes() } })
```

Each project is independent: its own program, its own isolation. Projects in the same worker share parsed files behind the scenes, so the second and later projects build markedly faster than the first.

## 6. Recipes

### Source and built output

A library promises the same editor experience from its source and from its published declarations. Loop over the entries; each test names its mode, and the mode keeps its precise type:

```ts
const entries = {
  source: './src/index.ts',
  built: './dist/index.js', // resolves to the adjacent dist/index.d.ts
} as const

const project = defineProject({ compilerOptions: { allowImportingTsExtensions: true } })

for (const [mode, entry] of Object.entries(entries)) {
  describe(mode, () => {
    it('documents every public export', () => {
      const result = project.query`
        import * as api from '${entry}'
        api.${cursor}
      `
      expect(result).toSuggest(PUBLIC_EXPORTS, { documented: true })
    })
  })
}
```

This proves your declarations survived the build. It does not prove an installed package resolves: for that, pack the package, install it into a fresh consumer, and run the same tests from there.

### A testing kit for your users

If your library has extension points — plugins, presets, design systems — your users write editor tests too. Give them a kit: a project preconfigured with your virtual modules, plus selenita's primitives in one import.

```ts
// @acme/kit/testing
import type { Project, ProjectConfig } from '@mszr/selenita/vitest'
import { defineProject } from '@mszr/selenita/vitest'

export { cursor, mark, snippet } from '@mszr/selenita/vitest'

export interface KitProjectConfig extends ProjectConfig {
  /** Source of the virtual `#kit/system` module. */
  system?: string
}

/** A selenita project with `#kit/system` ready to import. */
export function defineKitProject({ system = DEFAULT_SYSTEM, files, aliases, ...config }: KitProjectConfig = {}): Project {
  return defineProject({
    ...config,
    files: { '.kit/system.ts': system, ...files },
    aliases: { '#kit/system': './.kit/system.ts', ...aliases },
  })
}
```

Your users then test their extensions in a few lines, with the same matchers and failure output you use.

## 7. Performance

**You pay for what you read.** Each observation is computed the first time it is read:

| You read | The editor computes |
| --- | --- |
| `completions` | completion list only |
| `completionItem(name)` | details for that one entry |
| `completionItems`, or `toSuggest(…, { documented: true })` | details for every entry |
| `hover`, `signatureHelp`, `rename` | that one request |
| `errors` | syntactic and semantic diagnostics |
| `diagnostics` | those plus suggestion diagnostics |

So the cheapest test is the one that reads only what its promise needs — which is also the clearest test.

**Building the program** is the large fixed cost: parsing your project's root files and type libraries. It happens once per project. In Vitest it happens in `beforeAll`, so give hooks room in large projects:

```ts
// vitest.config.ts
export default defineConfig({
  test: { hookTimeout: 60_000 },
})
```

**Workers.** Each Vitest worker that runs editor tests holds its own TypeScript programs. On machines with many cores, Vitest's default worker count can oversubscribe the CPU; editor-heavy suites often run fastest with a few cores left free — measure and cap `maxWorkers` for your machine and CI.

## 8. The TypeScript backend

selenita's observations come from the TypeScript 6 language-service API, which it installs as its own dependency. That is why your project's `typescript` version does not matter: TypeScript 6 and TypeScript 7 projects both work. TypeScript 7 is designed for checking parity with 6, so editor evidence carries over; if you rely on a behavior that differs between them, test it in the editor too.

Plugins receive selenita's TypeScript instance, and `result.raw()` exposes it for anything selenita does not observe yet:

```ts
const definitions = result.raw(({ service, path }) =>
  service.getDefinitionAtPosition(path('__selenita__.ts'), result.range('call').start.offset),
)
```
