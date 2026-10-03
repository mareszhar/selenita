# selenita — vision

> **selenita lets you test what your users experience in their editor** — completions, hovers, diagnostics, signature help, rename — with tests that read like the code your users write.

The guiding question, for every decision:

> **What would feel most delightful to use?**

This document says why selenita exists, the model it is built on, the principles every change answers to, and what it deliberately is not. It is the first thing to read before changing selenita and the last thing to check before shipping a change.

## 1. Why selenita exists

The editor is where an API is actually used. Long before code runs, TypeScript's language service is a silent co-author: it suggests the next key, explains what a function is for, underlines a mistake, and shows which argument you are typing. For a library, that experience **is** API surface — often the most-used part of it.

And it regresses silently. Rename an option, reorder a union, wrap a type in one more generic, and nothing fails: no runtime error, no type error, just a dropdown that stopped offering the right thing or a hover that turned into forty lines of machinery.

selenita gives that surface the same protection runtime behavior gets:

```ts
import { cursor, defineProject } from '@mszr/selenita/vitest'
import { expect, it } from 'vitest'

const project = defineProject()

it('suggests every verb on the client', () => {
  const result = project.query`
    import { api } from './src'
    api.${cursor}
  `
  expect(result).toSuggest(['get', 'post', 'put', 'patch', 'delete'])
  expect(result).not.toSuggest(['entries', 'middlewares'])
})
```

The test is the example you already have in your head, with a cursor where the user's caret would be.

## 2. The model

Everything in selenita is one of four things:

```text
  project                    fixture                         observations
  ───────                    ───────                         ────────────
  your user's editor:   +    real TypeScript source,   ──▶   what the editor reports:
  tsconfig, files,           one file or several,            completions · hover ·
  aliases, plugins           with markers:                   signature help · rename ·
                               cursor  ⌶  a point            diagnostics · fixes
                               mark    ▭  some text                   │
                                                                      ▼
                                                             ordinary assertions
                                                             (expect — or matchers that
                                                              explain failures in source)
```

- A **project** is a TypeScript environment configured like your user's editor.
- A **fixture** is the source a query runs against. Markers are JavaScript values interpolated into it: a **cursor** is where you ask the editor a question; a **mark** names text you want to locate.
- An **observation** is what the editor reported: plain, frozen data, computed only when you read it.
- **Assertions** are ordinary. Matchers exist only where they explain a failure better than `toEqual` can.

The same four concepts explain the smallest test and the largest. A one-line completion check and a three-file rename through a language-service plugin differ in the size of the fixture, not in the ideas you need.

## 3. The editor promises

When people test their editor experience, they are checking one of five promises. selenita's documentation, observations, and matchers are organized around them:

| Your API promises to… | The user experiences… | selenita observes | Typical assertion |
| --- | --- | --- | --- |
| **Suggest** | typing `.` or `{` offers the right next step, and nothing internal | completions | `toSuggest`, `toSuggestOnly`, `toHaveCompletionParity` |
| **Explain** | hovering or browsing completions teaches what a thing is *for* | hover, completion details | `hover?.documentation`, `toSuggest(names, { documented: true })` |
| **Report** | a mistake is flagged where it was made, in words that help | diagnostics, fixes | `toHaveError(code, message, { on })`, `toBeClean` |
| **Guide** | while typing arguments, the editor shows which one you are on | signature help | `signatureHelp?.parameter` |
| **Navigate** | rename and references keep identity across files | rename | `rename.locations` |

The [promises guide](./guide/promises.md) is a cookbook for each.

## 4. Principles

Every change to selenita answers to these. None outranks the guiding question; together they make it operational.

1. **Write the example, not the harness.** Fixtures are real TypeScript. Markers are values, not offsets or magic comments. Setup is optional: `defineProject()` with no arguments finds your tsconfig.

2. **The common case is effortless; precision is one step away.** `hover?.text` reads the whole tooltip; `hover?.display` and `hover?.documentation` separate the shape from the prose. `{ on: 'paddin' }` locates an error by its text; `{ on: result.range('typo') }` pins it to one exact occurrence.

3. **Evidence is trustworthy.** A service failure is never reported as an empty result. Displays, positions, and module resolution are TypeScript's own, never rewritten for convenience. An unknown option, marker name, or misuse throws instead of being ignored. Green means the observation happened.

4. **Pay only for what you read.** Observations are computed on first access. A test that reads `completions` never pays for hovers, details, or diagnostics.

5. **A red test explains itself.** Failures show the fixture excerpt, the marker, what was expected, and what the editor actually said — so the fix is usually obvious without re-running anything.

6. **Names predict.** One word per concept, used identically in code, types, errors, and docs. The vocabulary lives in [language](./language.md).

7. **Compose before you specialize.** One fixture model (files + markers), one location model (ranges), one fan-out model (arrays + scopes). A new need is first met by an option on an existing concept, then by composition, and only last by a new concept.

8. **Plain values, ordinary assertions.** Results are plain data that work with any `expect`. Matchers are sugar that improves failure output; nothing requires them.

9. **Ownership is explicit.** The project owns the language service. The runner adapter owns lifecycle. Your test suite owns domain policy — which names count as internal, what a good hover says.

10. **Small on purpose.** selenita stays tiny so it stays obvious. Every addition earns its weight (§5).

## 5. Earning weight

selenita grows only when a change makes a real test clearer, its evidence stronger, or its setup disappear. Before adding or keeping anything, answer:

```text
Which real test is awkward, weak, or impossible today?            → show it
What does the same test look like after the change?               → show it
Which responsibility disappears from the person writing tests?    → name it
What concept, option, or export does selenita take on in return?  → name it
Does the same idea serve a second, different case?                → show it
Which test turns red if this promise breaks?                      → name it
```

A good change usually has a bonus: ranges made diagnostic locality testable, and the same ranges made rename locations and fix edits comparable for free. A change that needs its own special vocabulary, or serves exactly one call site, has not earned its place yet.

Removal is held to the same bar. A feature with no caller is weight, however cheap it looks.

## 6. Quality bar

A release ships when:

- **The contract is documented before it is built.** The reference describes the shipped behavior, in the present tense, with a runnable example.
- **Every promise has evidence that fails when the promise breaks** — with a positive control (the observation exists) beside every negative one (something is absent). See [evidence](./maintainers/evidence.md).
- **The installed package is proven,** not just the source: strict declaration checks, a fresh consumer on the supported toolchain, real runner execution.
- **Failure output was read by a human or agent** for each new matcher or error, and it explains the problem without opening the source.
- **selenita's own IntelliSense is tested with selenita.** A library about editor experience demonstrates its own.

## 7. Scope

selenita **is** an instrument for designing and protecting the editor experience of TypeScript APIs, through TypeScript's own language service.

selenita **is not**:

| Not this | Use instead |
| --- | --- |
| Type-level assertions (exact types, assignability) | Vitest's `expectTypeOf`, or `tsd` — complementary to selenita |
| An IDE simulator (dropdown ordering, filtering, rendering) | Native metadata is observable; UI behavior is out of reach by design |
| A test runner, or a matcher pack per runner | The core is runner-free; Vitest is the one adapter |
| Embedded-language tooling (Vue, Svelte, MDX templates) | A TypeScript language-service plugin, when one exists, via `plugins` |

**Backend.** Observations come from the TypeScript 6 language-service API, which selenita brings with it. Your project may use TypeScript 6 or 7. TypeScript 7's native compiler is designed for checking parity with 6; when it exposes a stable language-service API, a native backend can follow without changing the model.

## 8. Road to 1.0

selenita stays below 1.0 while its model is still being proven in real suites. It declares 1.0 when:

1. the reference projects (h3-dux, idb-dux, Vanity, Mana) run their complete editor suites on the current contract, including Vanity's plugin rename fixture;
2. one full release cycle passes with no breaking change to the public contract;
3. the package gate proves fresh consumers on TypeScript 6 and 7 with the supported Vitest major.

Until then, breaking changes are allowed when they serve the guiding question, and every one ships with a migration note an agent can apply mechanically.
