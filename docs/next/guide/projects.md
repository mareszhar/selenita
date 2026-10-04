# Projects

A project is the TypeScript environment your fixtures run in — configured to match what your users have in their editor. This guide covers configuration, variations, plugins, lifecycle, recipes for common setups, and performance.

## 1. Configuration at a glance

```ts
const project = defineProject({
  tsconfig: './tsconfig.json', // default: nearest tsconfig.json
  compilerOptions: { exactOptionalPropertyTypes: true }, // tsconfig.json spelling
  preferences: { includeCompletionsForModuleExports: true }, // editor settings
  files: { 'types/env.d.ts': 'declare const __DEV__: boolean' },
  aliases: { '#fixtures/*': './tests/fixtures/*' },
  plugins: [myLanguageServicePlugin],
})
```

| Option | Default | Purpose |
| --- | --- | --- |
| `tsconfig` | nearest `tsconfig.json`, walking up from the working directory | Which compiler options and root files your users have. `false` for an isolated in-memory setup. |
| `compilerOptions` | none | Adjust options in tsconfig.json spelling. Applied over the tsconfig. |
| `preferences` | a typical editor's ([details](../reference/api.md#projectconfig)) | Editor settings that change what the editor reports: auto-import suggestions, inlay hint kinds. |
| `files` | none | Virtual files that exist for the project's lifetime, e.g. generated declarations. |
| `aliases` | none | Import specifiers mapped to paths, like tsconfig `paths`. |
| `plugins` | none | TypeScript language-service plugins. |

Every option is validated when the project is created. A misspelled option or a tsconfig path that does not exist throws immediately, naming the problem.

**Paths resolve from the working directory** — the package Vitest runs in. Write `'./tsconfig.json'`, not `resolve(import.meta.dirname, …)`. The **project root** is the tsconfig's directory (the working directory when `tsconfig: false`); fixture files and `files` keys resolve from it.

## 2. tsconfig, compilerOptions, preferences

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

`preferences` are the editor's own settings — TypeScript's `UserPreferences`, passed through. selenita starts from what a typical editor sends, so a test sees what users see: members that need bracket insertion (`fruit['red-apple']`) and optional-chain members are suggested, and every kind of inlay hint is on. Auto-import suggestions are off by default because they are costly and flood identifier positions; turn them on to test import suggestions:

```ts
const project = defineProject({ preferences: { includeCompletionsForModuleExports: true } })
```

## 3. Virtual files

`files` adds files that live only in selenita's view of the project, for the project's whole lifetime. Use them for generated declarations, environment shims, or a module your fixtures import:

```ts
const project = defineProject({
  files: { '.kit/system.ts': `export { ds } from './src/system'` },
  aliases: { '#kit/system': './.kit/system.ts' },
})

project.query`
  import { ds } from '#kit/system'
  ds.${cursor}
`
```

Project files and fixture files are the same kind of thing with different lifetimes: project files last as long as the project, fixture files as long as one query. When extra source belongs to one scenario, put it in that query's fixture instead:

```ts
project.check({
  'env.d.ts': 'declare const FEATURE: true',
  'consumer.ts': 'const enabled: true = FEATURE',
})
```

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

## 4. Variations

A suite often needs the same environment with one thing different: an extra declaration file, a stricter compiler option, a plugin turned on. Configs compose in layers — later layers refine earlier ones, merging `files`, `aliases`, `compilerOptions`, and `preferences` by key and appending `plugins`:

```ts
const base = { aliases: { '@test': './src/test-support/index.ts' }, files: { 'env.d.ts': ENV } }

const project = defineProject(base)
const nuxtProject = defineProject(base, { files: { 'nuxt.d.ts': renderNuxtTypes() } }) // keeps env.d.ts
```

When you hold a project rather than its config — one returned by a testing kit, say — derive from it with `.extend()`:

```ts
const kitProject = defineKitProject({ schema })
const strictProject = kitProject.extend({ compilerOptions: { exactOptionalPropertyTypes: true } })
```

`extend()` uses the same layering: the derived project is built from the parent's layers plus yours. It is a separate project with its own service, built on first use and disposed with its parent. Inside a test, `using strict = project.extend({ … })` disposes it at the end of the test instead.

## 5. Plugins

Language-service plugins change what the editor reports: extra diagnostics, rename across custom identities, quick fixes. Pass a plugin's factory — the default export of a tsserver plugin module — optionally paired with the config it would read from its tsconfig entry:

```ts
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const plugin = require('./typescript-plugin.cjs')

const project = defineProject({
  plugins: [[plugin, { entryPoints: ['./src/index.ts'] }]],
})
```

selenita calls the factory with its own TypeScript instance, then `create(info)` once per project, before any observation. Every observation goes through the returned service.

selenita is a lighter host than tsserver, and says so: `info` provides the language service and its host, the config, and a minimal `project` (current directory, compiler options, project name, a logger that discards output). A plugin that reaches for anything else — `serverHost`, the tsserver session — gets a `SelenitaError` naming what it asked for, so you learn immediately that it needs a real editor to test. A plugin that reads files with `node:fs` sees the disk, not selenita's virtual files.

A plugin written inline makes service decoration a one-liner — useful for logging, counting requests, or injecting a failure in your own tests:

```ts
defineProject({
  plugins: [() => ({ create: info => withLogging(info.languageService) })],
})
```

## 6. Lifecycle

| | `defineProject` (from `/vitest`) | `createProject` (core) | `project.extend()` |
| --- | --- | --- | --- |
| Use in | Vitest test files, at module or `describe` scope | Scripts, benchmarks, other runners, inside a test | Anywhere you hold a project |
| Builds the initial program | in `beforeAll` | on first use, or `warmUp()` | on first use, or `warmUp()` |
| Disposes | in `afterAll` | `dispose()`, or `using` | with its parent, or earlier with `dispose()`/`using` |
| Matchers | installed by importing `/vitest` | not installed | — |

```ts
// Inside a single test: own it with `using`
it('reports the missing peer in an isolated environment', () => {
  using project = createProject({ tsconfig: false, files: { 'env.d.ts': 'declare const peer: never' } })
  expect(project.check`peer.connect()`.errors).toHaveErrorCount(1)
})
```

Rules worth knowing:

- Creating a project is cheap. `warmUp()` builds the initial program; `defineProject` calls it in `beforeAll` so that cost lands in the hook rather than the first test. Queries still do real work afterwards — each fixture updates the program, and each observation is a request.
- `dispose()` is idempotent. Querying a disposed project throws.
- Everything you already read from a result stays readable after disposal. Reading an observation for the first time after disposal throws, naming the observation.
- `defineProject` called inside a running test throws with a hint to use `createProject` with `using`, or `project.extend()`.

## 7. Recipes

### Source and built output

A library promises the same editor experience from its source and from its published declarations. When declarations sit next to the built entry, a loop is all it takes; each test names its mode, and the mode keeps its precise type:

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
      expect(result).toSuggest(PUBLIC_EXPORTS, { requireDocumentation: true })
    })
  })
}
```

When declarations live elsewhere, or the module context matters, describe each target fully with a record fixture: the declaration placed beside the entry, and a consumer file whose extension selects the context:

```ts
import { readFileSync } from 'node:fs'

const targets = {
  esm: { consumer: 'consumer.mts', entry: './dist/index.mjs', declarations: 'dist/index.d.mts' },
  cjs: { consumer: 'consumer.cts', entry: './dist/index.cjs', declarations: 'dist/index.d.cts' },
} as const

const project = defineProject({ compilerOptions: { module: 'nodenext', moduleResolution: 'nodenext' } })
const types = readFileSync('./types/index.d.ts', 'utf8')

for (const [mode, target] of Object.entries(targets)) {
  it(`[${mode}] suggests every client option`, () => {
    const result = project.query({
      [target.declarations]: types,
      [target.consumer]: snippet`
        import { createClient } from '${target.entry}'
        createClient({ ${cursor('options')} })
      `,
    })
    expect(result.at('options')).toSuggest(CLIENT_OPTIONS)
  })
}
```

These prove your declarations read well in each context. They do not prove an installed package resolves through its `exports` map: for that, pack the package, install it into a fresh consumer, and run the same tests from there.

```text
source alias              declaration overlay           installed consumer
────────────              ───────────────────           ──────────────────
the authored API          the emitted types, in a        the real export map,
                          chosen module context          files, and conditions
```

### A testing kit for your users

If your library has extension points — plugins, presets, design systems — your users write editor tests too. Give them a kit: your environment as a config, plus selenita's primitives in one import. Build it on the core entry so it works in any runner:

```ts
// @acme/kit/testing
import type { ProjectConfig } from '@mszr/selenita'

export { cursor, mark, snippet } from '@mszr/selenita'

export interface KitOptions {
  /** Source of the virtual `#kit/system` module. */
  system?: string
}

/** The environment a kit user's editor has: `#kit/system` ready to import. */
export function kitConfig({ system = DEFAULT_SYSTEM }: KitOptions = {}): ProjectConfig {
  return {
    files: { '.kit/system.ts': system },
    aliases: { '#kit/system': './.kit/system.ts' },
  }
}
```

Users compose it like any config — with their own layers on top:

```ts
// In Vitest
const project = defineProject(kitConfig({ system: `export { ds } from './src/system'` }), { tsconfig: './tsconfig.json' })

// Anywhere else
using project = createProject(kitConfig())
```

A kit may also ship a Vitest convenience (`defineKitProject = (options, ...configs) => defineProject(kitConfig(options), ...configs)`); its users can still derive variations with `.extend()`.

## 8. Performance

**You pay for what you read.** Each observation is computed the first time it is read:

| You read | The editor computes |
| --- | --- |
| `completionNames`, or the list fields of `completions` | the completion list |
| `findCompletion(name).documentation` (or `displayText`, `tags`, `codeActions`) | details for that one entry |
| `toSuggest(names, { requireDocumentation: true })` | details for the named entries only |
| `hover`, `signatureHelp`, `rename` | that one request |
| `errors` | syntactic and semantic diagnostics |
| `diagnostics` | those plus suggestion diagnostics |
| `inlayHints` | inlay hints for each fixture file |
| a diagnostic's `codeFixes` | code fixes for that diagnostic |

So the cheapest test is the one that reads only what its promise needs — which is also the clearest test.

**Building the initial program** is the large fixed cost: parsing your project's root files and type libraries. `defineProject` pays it in `beforeAll`, so give hooks room in large projects:

```ts
// vitest.config.ts
export default defineConfig({
  test: { hookTimeout: 60_000 },
})
```

Later projects in the same worker may reuse parsed files, so they usually build faster than the first.

**Workers.** Each Vitest worker that runs editor tests holds its own TypeScript programs. On machines with many cores, Vitest's default worker count can oversubscribe the CPU; editor-heavy suites often run fastest with a few cores left free — measure and cap `maxWorkers` for your machine and CI.

## 9. The TypeScript backend

selenita installs the TypeScript 6 language-service API as its own dependency, so it installs and runs in projects that use TypeScript 6 or TypeScript 7. Its observations are produced by that bundled TypeScript 6 language service. TypeScript 7 aims for type-checking parity with 6, but the two are different implementations: when a promise depends on behavior that might differ, confirm it in an editor running TypeScript 7 too.

Plugins receive selenita's TypeScript instance, and `result.inspect()` exposes it for anything selenita does not observe yet. The callback runs synchronously, with the result's fixture active:

```ts
const definitions = result.inspect(({ service, resolvePath }) =>
  service.getDefinitionAtPosition(resolvePath('__selenita__.ts'), result.rangeOf('call').start.offset),
)
```
