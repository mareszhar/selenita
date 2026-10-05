# selenita

> Test what your users see in their editor.

Every API has an editor experience: the suggestions people discover, the hovers they learn from, the errors that guide them. The coding agents working against your API read those same errors and docs.
It's part of your API, and it's the part nothing checks.

| After you refactor your library… | |
| --- | --- |
| Do the types still check? | ✓ |
| Do the runtime tests still pass? | ✓ |
| Does the editor still suggest `patch` after `api.`? | ❓ nothing tells you |

That third row is what **selenita** tests.
It exists so library authors can design a great editor experience and protect it, without the headache, with tests that read like the code your users write:

```ts
// tests/api.dx.test.ts — against your API exported from ./src
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

No line or column arithmetic, no magic comments, no DSL.
The template is real TypeScript, and `cursor` is a value you place where your user's caret would be.

## Highlights

- ✍️ **Tests that look like your users' code.** Real TypeScript with a cursor where the caret would be. No line numbers, no offsets.
- 🪄 **Nothing to set up.** It finds your tsconfig. No globals, no setup file.
- 👀 **Test suggestions, hovers, errors, rename, and more.** Signature help, inlay hints, and quick fixes too, all straight from TypeScript's language service.
- 🤖 **Helps agents, too.** Test that the errors and docs agents read point at the fix, and let your own agent check editor behavior without opening an editor.
- 🔍 **Failures you can act on.** You see the code, the cursor, what you expected, and what the editor said. A failed lookup throws; it never passes as an empty list.
- 🧩 **Keep related APIs consistent.** Write an example once, run it against many, and see exactly where they diverge.
- 📦 **Test your build, not just your source.** Run the same tests against your published declarations.
- 🔌 **Language-service plugins welcome.** Load yours and test what it adds.
- 🔤 **Autocomplete in your tests.** A typo in a marker name is a type error before the test runs.

## What you can test

Most editor tests check one of five promises your API makes to the people using it:

| Your API promises to… | So the user… | In your test |
| --- | --- | --- |
| **Suggest** | types `.` or `{` and is offered the right next step, and nothing internal | `toSuggest`, `toSuggestOnly`, `insertText` |
| **Explain** | hovers or browses suggestions and learns what a thing is *for* | `hover?.documentation`, `requireDocumentation` |
| **Report** | sees a mistake underlined where it was made, in words that help | `toHaveError(code, message, { on })`, `toBeClean` |
| **Guide** | sees which argument is which while typing a call | `signatureHelp`, `inlayHints` |
| **Navigate** | renames a symbol and every use follows, across files | `rename.locations` |

The [promises guide](https://github.com/mareszhar/selenita/blob/main/docs/guide/promises.md) has a recipe for each, including the assertions that look right but prove less than they seem.

## Get started

Adapt the example above, save it as `tests/api.dx.test.ts`, and two commands get you running:

```sh
pnpm add -D @mszr/selenita vitest
pnpm exec vitest run tests/api.dx.test.ts
```

You'll need Node 22.12+ and Vitest 5; the core also works in plain scripts and other runners.
selenita brings its own TypeScript 6 language service, so it works whether your project uses TypeScript 6 or 7.

## Failures that explain themselves

Say a refactor drops `patch`. The first test fails like this:

```text
expected cursor to suggest all of get, post, put, patch, delete
  __selenita__.ts:3:9
  2 │ import { api } from './src'
  3 │ api.
    │     ^
  missing: patch
  suggested (4): delete, get, post, put
```

The code, the cursor, the difference: the fix is usually obvious without re-running anything.

## Beyond a single test

### Keep related APIs consistent

Write an example once, run it at every position, and see exactly where they diverge:

```ts
import { cursor, defineProject, snippet } from '@mszr/selenita/vitest'
import { expect, it } from 'vitest'

const project = defineProject()

it('offers the same filters on every query', () => {
  const queries = ['db.findMany', 'db.findOne', 'db.aggregate'] as const
  const calls = queries.map(api => snippet`${api}({ where: { ${cursor('where')} } })`.scope(api))
  const result = project.query`
    import { db } from './src'
    ${snippet.join(calls, '\n')}
  `
  expect(result.errors).toBeClean()
  const members = result.atEach('where', queries)
  for (const observed of Object.values(members))
    expect(observed).toSuggest('status')
  expect(members).toHaveCompletionParity()
})
```

Naming the members catches one that went missing, and checking for a known suggestion catches the case where every member comes up empty.

### Test your build, not just your source

Your source and your published declarations can disagree.
Run the same tests against both and your users get the experience you designed.
The [source-and-built recipe](https://github.com/mareszhar/selenita/blob/main/docs/guide/projects.md#source-and-built-output) is a short loop.

### Make sure everything is documented

Want every public name to explain itself in the editor?
One assertion checks that each is suggested and documented, and lists every gap at once:

```ts
expect(result).toSuggest(PUBLIC_EXPORTS, { requireDocumentation: true })
```

## Good to know

- **It works alongside type tests.** `expectTypeOf` and `tsd` check what your types are; selenita checks what the editor shows.
- **It reads what TypeScript's language service reports.** It can't judge how a particular editor draws or orders its dropdown.
- **It tests itself the same way.** selenita's own editor experience is covered with selenita.
- **It's pre-1.0.** The model is still being proven by real use, so breaking changes can happen. Each one ships with a migration note.

## Documentation

| | |
| --- | --- |
| **[Getting started](https://github.com/mareszhar/selenita/blob/main/docs/guide/getting-started.md)** | Install, your first test, Vitest and standalone use |
| **[Vision](https://github.com/mareszhar/selenita/blob/main/docs/vision.md)** · **[Language](https://github.com/mareszhar/selenita/blob/main/docs/language.md)** | Why selenita exists, how it thinks, the words it uses |
| **[Fixtures](https://github.com/mareszhar/selenita/blob/main/docs/guide/fixtures.md)** | Cursors, marks, snippets, scopes, several files |
| **[Testing the editor promises](https://github.com/mareszhar/selenita/blob/main/docs/guide/promises.md)** | Suggest, explain, report, guide, navigate: the cookbook |
| **[Projects](https://github.com/mareszhar/selenita/blob/main/docs/guide/projects.md)** | Configuration, plugins, lifecycle, performance, testing kits |
| **[API reference](https://github.com/mareszhar/selenita/blob/main/docs/reference/api.md)** · **[Matchers](https://github.com/mareszhar/selenita/blob/main/docs/reference/matchers.md)** | Exact contracts |

## License

[AGPL-3.0-only](./LICENSE)
