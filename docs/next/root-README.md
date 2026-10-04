# selenita

> Test what your users see in their editor.

Your API's editor experience — what it suggests, how it explains itself, where it reports mistakes — is part of the API. It is often the most-used part, and it regresses silently. **selenita** lets you test it with tests that read like the code your users write.

```ts
import { cursor, defineProject } from '@mszr/selenita/vitest'
import { expect, it } from 'vitest'

const project = defineProject()

it('suggests every verb, and nothing internal', () => {
  const result = project.query`
    import { api } from './src'
    api.${cursor}
  `
  expect(result).toSuggest(['get', 'post', 'put', 'patch', 'delete'])
  expect(result).not.toSuggest(['entries', 'middlewares'])
})

it('reports a wrong field on the field itself', () => {
  const { errors } = project.check`
    import { api } from './src'
    api.post('/fruits', { body: { name: 'kiwi', pricePerKg: 'NaN' } })
  `
  expect(errors).toHaveErrorCount(1)
  expect(errors).toHaveError(2322, /not assignable to type 'number'/, { on: 'pricePerKg' })
})
```

No line or column arithmetic, no magic comments, no DSL. The fixture is real TypeScript; the cursor is a value you interpolate where the user's caret would be.

## Highlights

- **✍️ Write the example, not the harness** — cursors and marks are values in real source. `defineProject()` finds your tsconfig.
- **🎯 Every editor promise** — completions and what accepting them inserts, hovers (shape and docs, separately), diagnostics with exact locations, signature help, inlay hints, rename, and quick fixes you can apply and re-check.
- **🧩 Composable** — snippets carry their own markers, scopes keep names unique, arrays fan out, records span several files, and project configs stack in layers.
- **🔤 IntelliSense for your tests** — marker names autocomplete in `result.at('…')`, and typos are type errors.
- **🧾 Trustworthy evidence** — a failed observation is an error, never an empty list. Displays and resolution are TypeScript's own.
- **⚡ Pay for what you read** — observations are computed on first access.
- **🔍 Failures that explain** — every failure shows the fixture line, the marker, and what the editor actually said.
- **🔌 Plugins** — load TypeScript language-service plugins from their standard factories, and test what they add.
- **🧰 Installs alongside TypeScript 6 or 7** — selenita brings the TypeScript 6 language service it observes with.

## Install

```sh
pnpm add -D @mszr/selenita vitest
```

Node 22.12+, Vitest 5 for the matchers. The core works in any script without Vitest.

## Documentation

| | |
| --- | --- |
| **[Getting started](https://github.com/mareszhar/selenita/blob/main/docs/guide/getting-started.md)** | Install, first test, Vitest and standalone use |
| **[Fixtures](https://github.com/mareszhar/selenita/blob/main/docs/guide/fixtures.md)** | Cursors, marks, snippets, scopes, several files |
| **[Testing the editor promises](https://github.com/mareszhar/selenita/blob/main/docs/guide/promises.md)** | Suggest, explain, report, guide, navigate — the cookbook |
| **[Projects](https://github.com/mareszhar/selenita/blob/main/docs/guide/projects.md)** | Configuration, plugins, lifecycle, performance, testing kits |
| **[API reference](https://github.com/mareszhar/selenita/blob/main/docs/reference/api.md)** · **[Matchers](https://github.com/mareszhar/selenita/blob/main/docs/reference/matchers.md)** | Exact contracts |
| **[Vision](https://github.com/mareszhar/selenita/blob/main/docs/vision.md)** · **[Language](https://github.com/mareszhar/selenita/blob/main/docs/language.md)** | Why selenita exists, how it thinks, the words it uses |

## License

[AGPL-3.0-only](./LICENSE)
