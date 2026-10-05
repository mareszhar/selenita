# Matcher reference

Importing `@mszr/selenita/vitest` installs six matchers on Vitest's `expect`, with types. Matchers are optional: every observation is plain data that native assertions can check. They exist because they explain failures in the fixture's terms and state editor promises precisely.

| Promise | Matcher | Passes when |
| --- | --- | --- |
| Suggest | [`toSuggest(names, options?)`](#tosuggest) | every name is suggested (and documented, when required) |
| Suggest | [`toSuggestOnly(names)`](#tosuggestonly) | the suggested names equal `names` as a set |
| Suggest | [`toHaveCompletionParity()`](#tohavecompletionparity) | two or more members suggest the same set |
| Report | [`toBeClean()`](#tobeclean) | there are no errors |
| Report | [`toHaveError(code?, message?, options?)`](#tohaveerror) | some error matches every criterion given |
| Report | [`toHaveErrorCount(count)`](#tohaveerrorcount) | there are exactly `count` errors |

All matchers work with `.not`, `expect.soft`, `.resolves`/`.rejects`, and as asymmetric matchers (`expect.toSuggest(…)`, `expect.not.toSuggest(…)`).

## Receivers

Matchers accept the most natural thing to hand them:

| Matcher family | Accepts |
| --- | --- |
| Suggest | an `Observations` (`result.at(name)`, or a single-cursor result), a `readonly Completion[]` (`completions`), or a `readonly string[]` (`completionNames`) |
| Parity | a record of `Observations` (`result.atEach(name, scopes)`), of `readonly Completion[]`, or of `readonly string[]` |
| Report | a `readonly Diagnostic[]` (`errors`, `diagnostics`), or any result |

Prefer passing observations and results: failures can then show the fixture and the cursor. Name arrays work everywhere except `toSuggest(…, { requireDocumentation: true })`, which needs completions, not just their names.

Any other receiver fails with a message naming what was received and what the matcher expects.

## `toSuggest`

```ts
interface Matchers<R> {
  toSuggest: (names: string | readonly string[], options?: { requireDocumentation?: boolean }) => R
}
```

| Form | Passes when |
| --- | --- |
| `toSuggest('a')` | `a` is suggested |
| `toSuggest(['a', 'b'])` | every name is suggested; others may be too |
| `toSuggest(['a', 'b'], { requireDocumentation: true })` | every name is suggested, and each has non-blank documentation |
| `.not.toSuggest('a')` | `a` is not suggested |
| `.not.toSuggest(['a', 'b'])` | **none** of the names is suggested |

Negating a list means "none of these". That is a deliberate quantifier, not the logical complement of the positive form ("not all of these"): it is how the sentence reads, and the promise a forbidden-names check makes. `requireDocumentation` cannot be negated; the matcher throws if asked.

`requireDocumentation` resolves details only for the requested names — one request per matching entry, never the whole list. When a name appears more than once (from different `source` modules), every occurrence must be documented.

```text
expected cursor 'verbs' to suggest all of patch
  __selenita__.ts:3:7
  2 │ const api = { delete: 1, get: 1, head: 1, options: 1, post: 1, put: 1 };
  3 │ api.
    │     ^
  missing: patch
  suggested (6): delete, get, head, options, post, put
```

```text
expected cursor 'root' to suggest none of entries, middlewares, parentParams
  __selenita__.ts:3:7
  2 │ const api = { entries: 1, get: 1 };
  3 │ api.
    │     ^
  suggested anyway: entries
  suggested (2): entries, get
```

## `toSuggestOnly`

```ts
interface Matchers<R> {
  toSuggestOnly: (names: readonly string[]) => R
}
```

Passes when the set of suggested names equals the set of `names`. Order and duplicates are ignored on both sides. Negated, passes when the sets differ.

```text
expected cursor to suggest exactly /fruits, /reserve, /checkout
  missing: /checkout
  unexpected: /health
```

## `toHaveCompletionParity`

```ts
interface Matchers<R> {
  toHaveCompletionParity: () => R
}
```

Receives a record of observations (typically `result.atEach(name, scopes)`) or of name lists. Passes when every member suggests the same set of names; order and duplicates are ignored. Negated, passes when some members differ.

A comparison needs at least two members: an empty or single-member record throws in either form, because it almost always means a fan-out lost a member. List the expected scopes in `atEach(name, scopes)` so a missing member fails before parity is judged.

The judgment is [`compareCompletions`](./api.md#comparecompletions), available as data outside Vitest. The failure names a baseline — the set shared by the most members, ties going to the first member — and what each other member adds or lacks:

```text
expected completion parity across 3 members at cursor
  baseline (db.findMany, db.findOne): id, status, title
  db.aggregate: +groupBy  -status
```

## `toBeClean`

```ts
interface Matchers<R> {
  toBeClean: () => R
}
```

Passes when the receiver has no diagnostics with severity `error`. Warnings and suggestions do not count. On failure, every error is listed with its location and excerpt.

## `toHaveError`

```ts
interface Matchers<R> {
  toHaveError: {
    (code: number, options?: ErrorOptions): R
    (message: string | RegExp, options?: ErrorOptions): R
    (code: number, message: string | RegExp, options?: ErrorOptions): R
  }
}

interface ErrorOptions {
  /** Where the error must be underlined: the exact underlined text, or an exact range. */
  on?: string | Range
}
```

Passes when **some** error (severity `error`) matches every criterion given:

| Criterion | Matches when |
| --- | --- |
| `code` | `diagnostic.code === code` |
| `message: string` | the message contains the string |
| `message: RegExp` | a fresh copy of the pattern, with the same flags and `lastIndex` 0, matches the message — so `g`/`y` never carry state between checks, `y` still anchors at the start, and the caller's pattern is untouched |
| `on: string` | the diagnostic's `range.text` equals the string |
| `on: Range` | the diagnostic's range has the same file, start, and end |

Negated, passes when **no** error matches. `expect(errors).not.toHaveError(/Internal|Schema/)` therefore promises that no error mentions those words.

When the only near miss is a location, the failure shows both underlines:

```text
expected error 2322 on 'number'
  expected underline
  __selenita__.ts:2:16
  2 │ const value: number = 'bad'
    │              ~~~~~~
  actual underline
  __selenita__.ts:2:9
  2 │ const value: number = 'bad'
    │       ~~~~~
  [2322] Type 'string' is not assignable to type 'number'.
  __selenita__.ts:2:9
  2 │ const value: number = 'bad'
    │       ~~~~~
```

## `toHaveErrorCount`

```ts
interface Matchers<R> {
  toHaveErrorCount: (count: number) => R
}
```

Passes when the receiver has exactly `count` diagnostics with severity `error`. Failures list every error.

## Failure output

Every failure that involves a location shows an excerpt: the file and position, the line before when it helps, the line itself, and a caret (`^`) for cursors or tildes (`~`) for ranges. Lines are shown with their common indentation removed; positions in the header are the real ones. Lists longer than 20 names are truncated with a count. The output is plain text, so it reads the same in a terminal, a CI log, or an agent's context.

## Types

The augmentation follows Vitest's extension point exactly:

```ts
declare module 'vitest' {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    toSuggest: (names: string | readonly string[], options?: { requireDocumentation?: boolean }) => R
    // …
  }
}
```

So `await expect(promise).resolves.toSuggest('a')` is typed `Promise<void>`, and the asymmetric forms are typed through the same interface. The types load whenever `@mszr/selenita/vitest` is part of your TypeScript program — importing `defineProject` from it, directly or through a shared test-support module, is enough.
