# selenita — vision

> **selenita lets you test what your users experience in their editor** — completions, hovers, diagnostics, signature help, rename — with tests that read like the code your users write.

The guiding question, for every decision:

> **What would feel most delightful to use?**

This document says why selenita exists, the model it is built on, the principles every change answers to, and what it deliberately is not. It is the first thing to read before changing selenita and the last thing to check before shipping a change.

## 1. Why selenita exists

The editor is where an API is actually used. Long before code runs, TypeScript's language service is a silent co-author: it suggests the next key, explains what a function is for, underlines a mistake, and shows which argument you are typing. For a library, that experience **is** API surface — often the most-used part of it.

Coding agents lean on the same signals. An error that says what to change is often how an agent finds its fix on the next attempt, and the TSDoc a person sees on hover is what an agent reads in your declarations.

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

selenita runs headless and fails in plain text, so an agent working on your library can check the editor experience too — something that used to need a person with an editor open.

## 2. The model

Everything in selenita is one of four things:

```text
  project                    fixture                         observations
  ───────                    ───────                         ────────────
  your user's editor:   +    real TypeScript source,   ──▶   what the editor reports:
  tsconfig, preferences,     one file or several,            completions · hover ·
  files, aliases, plugins    with markers:                   signature help · inlay hints ·
                               cursor  ⌶  a point            rename · diagnostics · code fixes
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
| **Suggest** | typing `.` or `{` offers the right next step, nothing internal, and accepting it inserts the right code | completions (names, insertion, details) | `toSuggest`, `toSuggestOnly`, `toHaveCompletionParity`, `insertText` |
| **Explain** | hovering or browsing completions teaches what a thing is *for* | hover, completion details | `hover?.documentation`, `toSuggest(names, { requireDocumentation: true })` |
| **Report** | a mistake is flagged where it was made, in words that help | diagnostics, code fixes | `toHaveError(code, message, { on })`, `toBeClean` |
| **Guide** | while typing or reading a call, the editor shows which argument is which | signature help, inlay hints | `signatureHelp?.activeParameter`, `inlayHints` |
| **Navigate** | rename keeps identity across files | rename | `rename.locations` |

People and agents meet these promises differently. An agent rarely browses a dropdown, but it reads your errors and your documentation closely, so **Report** and **Explain** are where a clear message or a missing sentence matters most to it.

The [promises guide](./guide/promises.md) is a cookbook for each.

## 4. Principles

Every change to selenita answers to these. None outranks the guiding question; together they make it operational.

1. **Write the example, not the harness.** Fixtures are real TypeScript. Markers are values, not offsets or magic comments. Setup is optional: `defineProject()` with no arguments finds your tsconfig.

2. **The common case is effortless; precision is one step away.** `hover?.text` reads the whole tooltip; `hover?.displayText` and `hover?.documentation` separate the shape from the prose. `{ on: 'paddin' }` locates an error by its text; `{ on: result.rangeOf('typo') }` pins it to one exact occurrence.

3. **Evidence is trustworthy.** A service failure is never reported as an empty result. Displays, positions, and module resolution are TypeScript's own, never rewritten for convenience. An unknown option, marker name, or misuse throws instead of being ignored. Green means the observation happened.

4. **Pay only for what you read.** Observations are computed on first access. A test that reads `completionNames` never pays for hovers, details, or diagnostics.

5. **A red test explains itself.** Failures show the fixture excerpt, the marker, what was expected, and what the editor actually said — so the fix is usually obvious without re-running anything. It is plain text, so it reads as well in an agent's context as in a terminal.

6. **Names predict.** One word per concept, used identically in code, types, errors, and docs. The vocabulary lives in [language](./language.md).

7. **Preserve capabilities; simplify their expression.** What people can test is precious; how they spell it is negotiable. A capability is retired only when the model expresses it as clearly and reliably — never because a spelling went unused.

8. **Compose before you specialize.** One fixture model (files + markers), one location model (ranges), one configuration model (layers), one fan-out model (arrays + scopes). A new need is first met by an option on an existing concept, then by composition, and only last by a new concept.

9. **Plain data, ordinary assertions.** Results are frozen data, computed when first read, that work with any `expect`. Matchers are sugar that improves failure output; nothing requires them, and any judgment harder than a one-liner (completion parity) is also available as data from the core.

10. **Ownership is explicit.** The project owns the language service. The runner adapter owns lifecycle. Your test suite owns domain policy — which names count as internal, what a good hover says.

11. **Small on purpose.** selenita stays small so it stays obvious. Small means few ideas to learn, not few things to do: every concept earns its weight (§5), and no capability is pushed back onto the people writing tests.

## 5. Earning weight

The measure of selenita's size is how many ideas someone must hold to express an editor promise — and how much machinery its absence would push into their tests. Export counts and line counts are hints, not the measure.

**Adding.** A change earns its place when it makes a realistic test clearer, its evidence stronger, or its setup disappear:

```text
Which realistic test is awkward, weak, or impossible today?       → show it
What does the same test look like after the change?               → show it
Which responsibility disappears from the person writing tests?    → name it
What concept, option, or export does selenita take on in return?  → name it
Does the same idea serve a second, different case?                → show it
Which test turns red if this promise breaks?                      → name it
```

A good change usually has a bonus: ranges made diagnostic locality testable, and the same ranges made rename locations, fix edits, and inlay positions comparable for free. A change that needs its own special vocabulary to serve one scenario has not earned its place yet.

**Changing or removing.** Separate the capability (what someone can test) from its spelling (how they write it):

```text
Which editor promise does it let someone test?                    → one realistic example
Does the current model express that as clearly and reliably?     → the replacement, in full
What gets harder without it?                                     → lost precision, lost safety,
                                                                    repeated requests, merge code
```

Retire a spelling when the model expresses its purpose as well or better. Retire a capability only when the promise it serves is not a reasonable thing to want. Low adoption starts an investigation — was it hard to discover, awkward to use, or genuinely unneeded? — and never settles one.

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
| An agent evaluation (does a given agent succeed with your API?) | Run the agent. selenita tests the signals it reads: errors, documentation, displays |
| A test runner, or a matcher pack per runner | The core is runner-free; Vitest is the one adapter |
| Embedded-language tooling (Vue, Svelte, MDX templates) | A TypeScript language-service plugin, when one exists, via `plugins` |

**Backend.** selenita brings the TypeScript 6 language-service API with it, so it installs and runs in projects on TypeScript 6 or 7; its observations come from that TypeScript 6 service. TypeScript 7 aims for parity but is a separate implementation, so selenita states which backend produced its evidence rather than claiming equivalence. When TypeScript 7 exposes a stable language-service API, a native backend can follow without changing the model.

## 8. Road to 1.0

selenita stays below 1.0 while its model is still being proven by real use. There is no date: usage decides. 1.0 is due when all of these hold:

1. **The model has stopped moving.** Real suites — of different shapes, testing different kinds of APIs — have run on one contract through at least one full release with no breaking change needed.
2. **Every public capability has a documented purpose and evidence**, and none is waiting on a known redesign.
3. **The package gate proves the supported toolchains**: fresh consumers on each supported TypeScript and Vitest major.

Until then, breaking changes are allowed when they serve the guiding question, and every one ships with a migration note an agent can apply mechanically.
