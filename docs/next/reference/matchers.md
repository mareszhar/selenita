# Matcher reference

Importing `@mszr/selenita/vitest` installs six matchers on Vitest's `expect`, with types. Matchers are optional: every observation is plain data that native assertions can check. They exist because they explain failures in the fixture's terms and state editor promises precisely.

| Promise | Matcher | Passes when |
| --- | --- | --- |
| Suggest | [`toSuggest(names, options?)`](#tosuggest) | every name is suggested (and documented, if asked) |
| Suggest | [`toSuggestOnly(names)`](#tosuggestonly) | the suggested names equal `names` as a set |
| Suggest | [`toHaveCompletionParity()`](#tohavecompletionparity) | every member suggests the same set |
| Report | [`toBeClean()`](#tobeclean) | there are no errors |
| Report | [`toHaveError(code?, message?, options?)`](#tohaveerror) | some error matches every criterion given |
| Report | [`toHaveErrorCount(count)`](#tohaveerrorcount) | there are exactly `count` errors |

All matchers work with `.not`, `expect.soft`, `.resolves`/`.rejects`, and as asymmetric matchers (`expect.toSuggest(…)`, `expect.not.toSuggest(…)`).

## Receivers

Matchers accept the most natural thing to hand them:

| Matcher family | Accepts |
| --- | --- |
| Suggest | an `Observations` (`result.at(name)`, or a single-cursor result), or a `readonly string[]` of names |
| Parity | a record of `Observations` (`result.across(name)`) or of `readonly string[]` |
| Report | a `readonly Diagnostic[]` (`errors`, `diagnostics`), or any result |

Prefer passing observations and results: failures can then show the fixture and the cursor. Name arrays work everywhere except `toSuggest(…, { documented: true })`, which needs completion details.

Any other receiver fails with a message naming what was received and what the matcher expects.

## `toSuggest`

```ts
interface Matchers<R> {
  toSuggest: (names: string | readonly string[], options?: { documented?: boolean }) => R
}
```

| Form | Passes when |
| --- | --- |
| `toSuggest('a')` | `a` is suggested |
| `toSuggest(['a', 'b'])` | every name is suggested; others may be too |
| `toSuggest(['a', 'b'], { documented: true })` | every name is suggested, and each has non-blank documentation |
| `.not.toSuggest('a')` | `a` is not suggested |
| `.not.toSuggest(['a', 'b'])` | **none** of the names is suggested |

Negating a list means "none of these" — the reading of the sentence, and the promise behind every negated list in practice. `documented` cannot be negated; the matcher throws if asked.

```text
expected cursor 'verbs' to suggest 'patch'
  __selenita__.ts:3:7
    3 │   api.
      │       ^
  suggested (6): delete, get, head, options, post, put
```

```text
expected cursor 'root' to suggest none of 3 names
  __selenita__.ts:3:30
    3 │   createRouter('/fruits').
      │                           ^
  suggested anyway: entries
```

## `toSuggestOnly`

```ts
interface Matchers<R> {
  toSuggestOnly: (names: readonly string[]) => R
}
```

Passes when the set of suggested names equals the set of `names`. Order and duplicates are ignored on both sides. Negated, passes when the sets differ.

```text
expected cursor to suggest exactly 4 names
  missing:    /checkout
  unexpected: /health
```

## `toHaveCompletionParity`

```ts
interface Matchers<R> {
  toHaveCompletionParity: () => R
}
```

Receives a record of observations (typically `result.across(name)`) or of name lists. Passes when every member suggests the same set of names; order and duplicates are ignored. An empty record or a single member passes. Negated, passes when at least two members differ.

The failure names a baseline — the set shared by the most members, ties going to the first member — and what each other member adds or lacks:

```text
expected completion parity across 3 members at 'where'
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
| `message: RegExp` | the pattern matches the message; `g`/`y` flags never carry state between checks |
| `on: string` | the diagnostic's `range.text` equals the string |
| `on: Range` | the diagnostic's range has the same file, start, and end |

Negated, passes when **no** error matches. `expect(errors).not.toHaveError(/Internal|Schema/)` therefore promises that no error mentions those words.

When the only near miss is a location, the failure shows both underlines:

```text
expected error 2561 on 'paddin'
  __selenita__.ts:3:11
    3 │   style({ paddin: 8 })
      │           ~~~~~~      expected
      │         ~~~~~~~~~~~~  actual: Object literal may only specify known properties, …
  other errors: 0
```

## `toHaveErrorCount`

```ts
interface Matchers<R> {
  toHaveErrorCount: (count: number) => R
}
```

Passes when the receiver has exactly `count` diagnostics with severity `error`. Failures list every error.

## Failure output

Every failure that involves a location shows an excerpt: the file and position, the line before when it helps, the line itself, and a caret (`^`) for cursors or tildes (`~`) for ranges. Lines are shown with their common indentation removed; positions in the header are the real ones. Lists longer than 20 names are truncated with a count.

## Types

The augmentation follows Vitest's extension point exactly:

```ts
declare module 'vitest' {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> {
    toSuggest: (names: string | readonly string[], options?: { documented?: boolean }) => R
    // …
  }
}
```

So `await expect(promise).resolves.toSuggest('a')` is typed `Promise<void>`, and the asymmetric forms are typed through the same interface. The types load whenever `@mszr/selenita/vitest` is part of your TypeScript program — importing `defineProject` from it, directly or through a shared test-support module, is enough.
