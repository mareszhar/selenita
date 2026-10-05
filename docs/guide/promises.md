# Testing the editor promises

Editor tests check one of five promises your API makes to the people using it. This guide is a cookbook for each — what the user experiences, how to observe it, which assertion states the promise exactly, and the look-alike assertions that prove less than they seem.

| Promise | The user experiences… | Section |
| --- | --- | --- |
| **Suggest** | typing `.` or `{` offers the right next step, and nothing internal | [§1](#1-suggest) |
| **Explain** | hovering or browsing completions teaches what a thing is *for* | [§2](#2-explain) |
| **Report** | a mistake is underlined where it was made, in words that help | [§3](#3-report) |
| **Guide** | while typing or reading a call, the editor shows which argument is which | [§4](#4-guide) |
| **Navigate** | rename keeps identity across files | [§5](#5-navigate) |

[§6](#6-strong-evidence) collects the habits that keep editor tests honest.

## 1. Suggest

### Required names

```ts
const result = project.query`
  import { api } from './src'
  api.${cursor}
`
expect(result).toSuggest(['get', 'post', 'put', 'patch', 'delete'])
expect(result).toSuggest('use')
```

`toSuggest` takes one name or a list and passes when every name is suggested. Extra suggestions are fine — this is the right default, because TypeScript and other libraries may add entries you do not control.

### Forbidden names

```ts
expect(result).not.toSuggest(['entries', 'middlewares', 'parentParams'])
```

Negated, a list means **none of these**. One leaked internal fails the test and names it. Pair a negative with a positive in the same test, so an empty dropdown — a broken import, a typo in the fixture — cannot pass as "nothing leaked":

```ts
expect(result).toSuggest('get') // the cursor is where you think
expect(result).not.toSuggest(['entries', 'middlewares']) // and nothing internal is there
```

### Exactly these names

```ts
const result = project.query`
  import { api } from './src'
  api.post('${cursor}')
`
expect(result).toSuggestOnly(['/fruits', '/fruits/:id/reserve', '/checkout'])
```

`toSuggestOnly` compares sets: order and duplicates do not matter. Use it for closed sets (route names, enum-like unions, keys of a finite record). String-literal suggestions appear without their quotes.

When the editor offers an intended extra entry, such as an error hint your types surface while a value is still invalid, exclude it from the public-set comparison. Assert the hint separately if its presence is also a promise:

```ts
const names = result.completionNames.filter(name => !name.startsWith('MYLIBERR_'))
expect(names).toSuggestOnly(['inviteCode', 'id'])
```

### The same suggestions everywhere

Equivalent APIs should offer the same completions at equivalent positions. Fan out with an array, scope each member, and compare:

```ts
const queries = ['db.findMany', 'db.findOne', 'db.aggregate'] as const
const calls = queries.map(api => snippet`${api}({ where: { ${cursor('where')} } })`.scope(api))

const result = project.query`
  import { db } from './src'
  ${snippet.join(calls, '\n')}
`
expect(result.errors).toBeClean()
expect(result.atEach('where', queries)).toHaveCompletionParity()
```

Passing `queries` to `atEach` makes membership explicit: if one member lost its cursor, the test fails naming it, instead of comparing the rest. On failure, the matcher shows the majority set and what each divergent member added or lost. Parity also holds when every set is empty, so add a known member when the scenario promises one:

```ts
for (const observed of Object.values(result.atEach('where', queries)))
  expect(observed).toSuggest('status')
```

Outside Vitest, `compareCompletions(result.atEach('where', queries))` returns the same judgment as data.

For just two positions, `toSuggestOnly` reads naturally:

```ts
expect(result.at('hook')).toSuggestOnly(result.at('once').completionNames)
```

### What accepting a suggestion does

A name in the list proves discovery. What happens when the user accepts it is a separate promise — and each completion carries it:

```ts
const result = project.query`
  const fruit = { 'red-apple': 1, kiwi: 2 }
  fruit.${cursor}
`
const completion = result.findCompletion('red-apple')
expect(completion).toMatchObject({ insertText: '["red-apple"]' })
expect(completion?.replacementRange?.text).toBe('.') // fruit.  →  fruit["red-apple"]
```

With auto-import suggestions turned on, the same completion tells you where an import would come from. The service must already know the module: introduce your installed dependency in a separate project file, then query a fresh module with no existing import from it:

```ts
// @acme/http is installed and exports createClient and the Client type.
const autoImportProject = defineProject({
  preferences: { includeCompletionsForModuleExports: true },
  files: { 'auto-import-seed.ts': `import type { Client } from '@acme/http'` },
})
const result = autoImportProject.query`export {}; crea${cursor}`
const completion = result.findCompletion({ name: 'createClient', source: '@acme/http' })
expect(completion).toMatchObject({ name: 'createClient', source: '@acme/http' })
expect(completion?.codeActions[0]?.edits[0]?.newText).toMatch(/from ['"]@acme\/http['"]/)
```

`includeCompletionsForModuleExports` enables suggestions from modules known to the service; it does not reproduce an editor's full package-discovery machinery. Here `codeActions` holds the new import in the queried file, so the test can promise that users auto-import your public entry, never a deep internal path.

## 2. Explain

### Hover: shape and purpose

A hover has two parts users read differently: the **display text** (the signature or type, in a code block) and the **documentation** (the prose). selenita keeps them apart, and also gives you the whole tooltip:

```ts
const { hover } = project.query`
  import { createQuery } from './src'
  ${cursor}createQuery
`
hover?.displayText // 'function createQuery(options: QueryOptions): Query'
hover?.documentation // 'Build a typed query against one table.'
hover?.tags // [{ name: 'example', text: "createQuery({ table: 'users' })" }]
hover?.text // display text, blank line, documentation, tags — as a reader sees it
```

Assert the part your promise is about:

```ts
// "hover teaches what it is for": the prose
expect(hover?.documentation).toMatch(/^Build a typed query/)

// "the type reads as the user's shape, not our machinery": the display text
expect(hover?.displayText).toContain('pricePerKg: number')
expect(hover?.displayText).not.toMatch(/ObjectSchema|SerializeObject/)
```

A shape check against `text` would also scan the documentation, so prose mentioning an internal name could fail a leak guard, and documentation could satisfy a shape check. Keep them separate.

### Compact displays

When the promise is "this type renders compactly", pin the display exactly. An inline snapshot is the most readable form:

```ts
expect(hover?.displayText).toMatchInlineSnapshot(`"const handle: TokenHandle<\"color\">"`)
```

selenita never rewrites displays — no alias expansion, no trimming — so a snapshot captures what users see.

### Every public name documented

Libraries promise that browsing completions teaches each entry's purpose, and the same documentation is what an agent reads in your declarations. One assertion checks presence and documentation for a whole list, and reports every gap at once:

```ts
const result = project.query`
  import * as runtime from '@acme/kit/runtime'
  runtime.${cursor}
`
expect(result).toSuggest(PUBLIC_RUNTIME_EXPORTS, { requireDocumentation: true })
```

The failure lists every missing or undocumented name together:

```text
  missing: restoreAnatomy
  undocumented: bindPort, ports
```

"Documented" means non-blank documentation. For a specific sentence, read the completion:

```ts
expect(result.findCompletion('compiler')?.documentation).toContain('Compiler options')
```

## 3. Report

### Valid code is clean

Every error test needs a clean neighbor proving the happy path really is happy:

```ts
const { errors } = project.check`
  import { createQuery } from './src'
  createQuery({ table: 'users', limit: 10 })
`
expect(errors).toBeClean()
```

`check` observes diagnostics in the fixture files. Imported and project files provide their typing environment, but their own diagnostics are not collected. Keep a whole-project typecheck alongside these focused editor tests.

### One mistake, one error

The promise is usually "exactly one actionable error", so assert the count and the error separately:

```ts
const { errors } = project.check`
  import { api } from './src'
  api.post('/fruits', { body: { name: 'kiwi', pricePerKg: 'NaN' } })
`
expect(errors).toHaveErrorCount(1)
expect(errors).toHaveError(2322, /not assignable to type 'number'/)
```

`toHaveError` matches a code, a message, or both. A string message matches as a substring (`'does not exist'`); a regular expression matches as a pattern, which is handy when the message itself contains quotes. Count stays a separate assertion so the right error cannot hide collateral ones.

### Underlined in the right place

"The error points at the offending key" is a promise about location. State it:

```ts
const { errors } = project.check`
  ${prelude}
  q({ tasks: { $: { where: { tagName: 'x' } } } })
`
expect(errors).toHaveError(/WHERE_KEY_UNKNOWN/, { on: 'tagName' })
```

`on: 'tagName'` passes when the error's underline covers exactly that text. When the text occurs more than once, mark the occurrence you mean:

```ts
const result = project.check`
  ${prelude}
  q({ tagName: {}, tasks: { $: { where: { ${mark('key')`tagName`}: 'x' } } } })
`
expect(result.errors).toHaveError(/WHERE_KEY_UNKNOWN/, { on: result.rangeOf('key') })
```

If TypeScript underlines a wider expression than you expected, the failure shows both underlines. That is the finding: improve the types so the error lands on the key, or mark the wider expression if that is the experience you intend.

### Nothing internal in the message

Error messages are UI too, for the people who read them and for the coding agents that read them to decide their next edit. To promise that no error mentions your internals, negate:

```ts
const INTERNALS = /ObjectSchema|SchemaWithPipe|NoExcess|Overload \d of/
expect(errors).not.toHaveError(INTERNALS)
```

Negated, `toHaveError` means no error matches — no helper loop needed.

### Warnings, suggestions, and plugin diagnostics

`errors` holds diagnostics with severity `error`. `diagnostics` holds everything, including suggestions such as "declared but never used" and those a language-service plugin adds with its own codes:

```ts
expect(result.diagnostics).toContainEqual(expect.objectContaining({
  code: 6133, // 'x' is declared but its value is never read
  severity: 'suggestion',
}))
```

### Quick fixes that work

A diagnostic knows the code fixes the editor would offer for it (`codeFixes`). Each fix's `fixedFiles` holds the fixture's files with the edits applied, ready to check again — so a test proves the fix works, not just that it is listed:

```ts
const result = project.check`
  const fruitBasket = ['apple']
  fruitBaskt.push('kiwi')
`
const [typo] = result.errors // 2552: Cannot find name 'fruitBaskt'. Did you mean 'fruitBasket'?
const fix = typo?.codeFixes.find(fix => fix.description.startsWith('Change spelling'))

expect(fix?.edits[0]?.newText).toBe('fruitBasket')
expect(project.check(fix!.fixedFiles).errors).toBeClean()
```

The same works for a plugin's own diagnostics and fixes. `fixedFiles` transforms text; a fix that needs an editor command cannot be applied as text, and says so.

## 4. Guide

Signature help is what the editor shows while typing arguments. `activeSignature` is the overload in use and `activeParameter` the parameter being typed, so the common reads are short:

```ts
const { signatureHelp } = project.query`
  import { setCustomProperty } from './src/runtime'
  declare const element: HTMLElement
  setCustomProperty(element, ${cursor})
`
expect(signatureHelp?.activeParameterIndex).toBe(1)
expect(signatureHelp?.activeParameter?.documentation).toContain('token handle')
expect(signatureHelp?.activeSignature.parameters).toHaveLength(3)
```

`signatures` lists every overload when the promise concerns them all.

### Inlay hints

Inlay hints guide readers of code that is already written: parameter names before arguments, inferred types after declarations. Place cursors where the hints should appear:

```ts
const result = project.query`
  declare function pack(count: number): string
  const label${cursor('type')} = pack(${cursor('count')}3)
`
expect(result.inlayHints).toContainEqual({ text: ': string', kind: 'type', range: result.rangeOf('type') })
expect(result.inlayHints).toContainEqual({ text: 'count:', kind: 'parameter', range: result.rangeOf('count') })
```

Every kind of hint is on by default; set `includeInlay…` [preferences](./projects.md#2-tsconfig-compileroptions-preferences) to test a specific editor setup. A guard that no hint leaks internal types reads like any other:

```ts
for (const hint of result.inlayHints)
  expect(hint.text).not.toMatch(/Internal/)
```

## 5. Navigate

Rename is a promise about identity: renaming a token at its definition or at a use site touches the same places, across files, and nothing else.

```ts
const result = project.query({
  'tokens.ts': snippet`export const tokens = { ${mark('definition')`brand`}: '#635bff' }`,
  'other.ts': snippet`export const other = { brand: '#000' }`,
  'consumer.ts': snippet`
    import { tokens } from './tokens'
    void tokens.${mark('use')`brand`}
  `,
})

// sorted by file, then position: consumer.ts before tokens.ts
const expected = [result.rangeOf('use'), result.rangeOf('definition')]
expect(result.at('definition').rename.locations).toEqual(expected)
expect(result.at('use').rename.locations).toEqual(expected)
```

The unrelated `brand` in `other.ts` is the negative control: equality proves it is excluded. When rename is refused, `canRename` is `false` and `reason` carries the editor's message.

When identity flows through types TypeScript cannot trace — keys inferred through mapped types, say — a language-service plugin can supply the missing locations. Load it with [`plugins`](./projects.md#5-plugins) and the same test proves it.

## 6. Strong evidence

An editor test is evidence. These habits keep it from passing for the wrong reason:

| Looks like a check | What it actually proves | State the promise instead |
| --- | --- | --- |
| `expect(result).not.toSuggest('internal')` alone | Nothing, if the dropdown is empty | Add `expect(result).toSuggest('public')` first |
| `expect(completion?.displayText).not.toMatch(/any/)` | An empty display passes; missing data throws in Vitest 5 | Assert presence and a meaningful display first, then guard unwanted text |
| `expect(completion?.isDeprecated).not.toBe(true)` | Nothing, if `completion` is missing | `expect(completion).toMatchObject({ isDeprecated: false })` — presence and value at once |
| `expect(hover).toBeDefined()` | Nothing — `null` is defined | `expect(hover).not.toBeNull()` |
| `expect(errors.length).toBeGreaterThan(0)` | Some error, any error | `toHaveError(code, message)` |
| `toHaveError(...)` alone, for "one actionable error" | A matching error exists among others | Add `toHaveErrorCount(1)` |
| `expect(errors).toHaveErrorCount(errors.length)` | Nothing — it compares a value with itself | A literal count |
| A locality test comparing a diagnostic with itself | Nothing about location | `{ on: 'text' }` or `{ on: result.rangeOf('mark') }` |
| `toHaveCompletionParity()` on `atEach(name)` | Equality among whichever members kept the cursor | `atEach(name, scopes)`, plus `toSuggest` one known member |
| `expect(hover?.text).not.toMatch(LEAK)` | Mixes display and prose | Guard `hover?.displayText` |

And two habits for the suite as a whole:

- **Snapshot fields, not results.** `expect(hover?.displayText).toMatchInlineSnapshot()` pins one promise. Snapshotting a whole result pins everything the editor said, so unrelated TypeScript changes break it.
- **Keep domain policy in your suite.** Your list of internal names, your documentation standard, your error-code prefix: these belong in a shared module of your tests, not in selenita.
