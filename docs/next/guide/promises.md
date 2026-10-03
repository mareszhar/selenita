# Testing the editor promises

Editor tests check one of five promises your API makes to the people using it. This guide is a cookbook for each — what the user experiences, how to observe it, which assertion states the promise exactly, and the look-alike assertions that prove less than they seem.

| Promise | The user experiences… | Section |
| --- | --- | --- |
| **Suggest** | typing `.` or `{` offers the right next step, and nothing internal | [§1](#1-suggest) |
| **Explain** | hovering or browsing completions teaches what a thing is *for* | [§2](#2-explain) |
| **Report** | a mistake is underlined where it was made, in words that help | [§3](#3-report) |
| **Guide** | while typing arguments, the editor shows which one you are on | [§4](#4-guide) |
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

When the editor offers an intended extra entry, such as an error hint your types surface while a value is still invalid, state both facts:

```ts
const names = result.completions.filter(name => !name.startsWith('MYLIBERR_'))
expect(names).toSuggestOnly(['inviteCode', 'id'])
```

### The same suggestions everywhere

Equivalent APIs should offer the same completions at equivalent positions. Fan out with an array, scope each member, and compare:

```ts
const queries = ['db.findMany', 'db.findOne', 'db.aggregate'] as const

const result = project.query`
  import { db } from './src'
  ${queries.map(api => snippet`\n${api}({ where: { ${cursor('where')} } })`.for(api))}
`
expect(result.across('where')).toHaveCompletionParity()
```

On failure, the matcher shows the majority set and what each divergent member added or lost. Parity also holds when every set is empty, so add a known member when the scenario promises one:

```ts
for (const observed of Object.values(result.across('where')))
  expect(observed).toSuggest('status')
```

For just two positions, `toSuggestOnly` reads naturally:

```ts
expect(result.at('hook')).toSuggestOnly(result.at('once').completions)
```

## 2. Explain

### Hover: shape and purpose

A hover has two parts users read differently: the **display** (the signature or type, in a code block) and the **documentation** (the prose). selenita keeps them apart, and also gives you the whole tooltip:

```ts
const { hover } = project.query`
  import { createQuery } from './src'
  ${cursor}createQuery
`
hover?.display // 'function createQuery(options: QueryOptions): Query'
hover?.documentation // 'Build a typed query against one table.'
hover?.tags // [{ name: 'example', text: "createQuery({ table: 'users' })" }]
hover?.text // display, blank line, documentation, tags — as a reader sees it
```

Assert the part your promise is about:

```ts
// "hover teaches what it is for": the prose
expect(hover?.documentation).toMatch(/^Build a typed query/)

// "the type reads as the user's shape, not our machinery": the display
expect(hover?.display).toContain('pricePerKg: number')
expect(hover?.display).not.toMatch(/ObjectSchema|SerializeObject/)
```

A display check against `text` would also scan the documentation, so prose mentioning an internal name could fail a leak guard, and documentation could satisfy a shape check. Keep them separate.

### Compact displays

When the promise is "this type renders compactly", pin the display exactly. An inline snapshot is the most readable form:

```ts
expect(hover?.display).toMatchInlineSnapshot(`"const handle: TokenHandle<'color'>"`)
```

selenita never rewrites displays — no alias expansion, no trimming — so a snapshot captures what users see.

### Every public name documented

Libraries promise that browsing completions teaches each entry's purpose. One assertion checks presence and documentation for a whole list, and reports every gap at once:

```ts
const result = project.query`
  import * as runtime from '@acme/kit/runtime'
  runtime.${cursor}
`
expect(result).toSuggest(PUBLIC_RUNTIME_EXPORTS, { documented: true })
```

```text
expected cursor to suggest 15 names, each documented
  missing:      restoreAnatomy
  undocumented: bindPort, ports
```

"Documented" means non-blank documentation. For a specific sentence, read the item:

```ts
expect(result.completionItem('compiler')?.documentation).toContain('Compiler options')
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
expect(result.errors).toHaveError(/WHERE_KEY_UNKNOWN/, { on: result.range('key') })
```

If TypeScript underlines a wider expression than you expected, the failure shows both underlines. That is the finding: improve the types so the error lands on the key, or mark the wider expression if that is the experience you intend.

### Nothing internal in the message

Error messages are UI too. To promise that no error mentions your internals, negate:

```ts
const INTERNALS = /ObjectSchema|SchemaWithPipe|NoExcess|Overload \d of/
expect(errors).not.toHaveError(INTERNALS)
```

Negated, `toHaveError` means no error matches — no helper loop needed.

### Warnings, suggestions, and plugin diagnostics

`errors` holds diagnostics with severity `error`. `diagnostics` holds everything, including suggestions such as "declared but never used" and those a language-service plugin adds:

```ts
expect(result.diagnostics).toContainEqual(expect.objectContaining({
  code: 990001,
  severity: 'suggestion',
}))
```

### Quick fixes that work

A diagnostic knows the fixes the editor would offer for it. `apply()` returns the fixture's files with the edits applied, ready to check again — so a test proves the fix works, not just that it is listed:

```ts
const result = project.check({
  'button.css.ts': 'void cls\n',
})
const diagnostic = result.diagnostics.find(d => d.code === 990001)!
const fix = diagnostic.fixes.find(f => f.description === 'Add the type-only unlock import')!

expect(fix.edits[0]?.newText).toContain('vanity-style-auto-imports')
expect(project.check(fix.apply()).errors).toBeClean()
```

## 4. Guide

Signature help is what the editor shows while typing arguments. `signature` is the active overload and `parameter` the active parameter, so the common reads are short:

```ts
const { signatureHelp } = project.query`
  import { setCustomProperty } from './src/runtime'
  declare const element: HTMLElement
  setCustomProperty(element, ${cursor})
`
expect(signatureHelp?.activeParameter).toBe(1)
expect(signatureHelp?.parameter?.documentation).toContain('token handle')
expect(signatureHelp?.signature.parameters).toHaveLength(3)
```

`signatures` lists every overload when the promise concerns them all.

## 5. Navigate

Rename is a promise about identity: renaming a token at its definition or at a use site touches the same places, across files, and nothing else.

```ts
const project = defineProject({ plugins: [renamePlugin] })

const result = project.query({
  'tokens.ts': snippet`export const tokens = defineTokens({ ${mark('definition')`brand`}: '#635bff' })`,
  'other.ts': snippet`export const other = defineTokens({ brand: '#000' })`,
  'consumer.ts': snippet`
    import { tokens } from './tokens'
    void tokens.t.${mark('use')`brand`}
  `,
})

const expected = [result.range('definition'), result.range('use')]
expect(result.at('definition').rename.locations).toEqual(expected)
expect(result.at('use').rename.locations).toEqual(expected)
```

The unrelated `brand` in `other.ts` is the negative control: equality proves it is excluded. Locations are sorted by file, then position. When rename is refused, `canRename` is `false` and `reason` carries the editor's message.

Plugins are the standard TypeScript language-service plugin factories; see [projects](./projects.md#plugins).

## 6. Strong evidence

An editor test is evidence. These habits keep it from passing for the wrong reason:

| Looks like a check | What it actually proves | State the promise instead |
| --- | --- | --- |
| `expect(result).not.toSuggest('internal')` alone | Nothing, if the dropdown is empty | Add `expect(result).toSuggest('public')` first |
| `expect(item?.display).not.toMatch(/any/)` | Nothing, if `item` is missing | `expect(item).toBeDefined()` first, or `toSuggest(name)` |
| `expect(hover).toBeDefined()` | Nothing — `null` is defined | `expect(hover).not.toBeNull()` |
| `expect(errors.length).toBeGreaterThan(0)` | Some error, any error | `toHaveError(code, message)` |
| `toHaveError(...)` alone, for "one actionable error" | A matching error exists among others | Add `toHaveErrorCount(1)` |
| `expect(errors).toHaveErrorCount(errors.length)` | Nothing — it compares a value with itself | A literal count |
| A locality test comparing a diagnostic with itself | Nothing about location | `{ on: 'text' }` or `{ on: result.range('mark') }` |
| `toHaveCompletionParity()` alone | Equality, possibly of empty sets | Also `toSuggest` one known member |
| `expect(hover?.text).not.toMatch(LEAK)` | Mixes display and prose | Guard `hover?.display` |

And two habits for the suite as a whole:

- **Snapshot fields, not results.** `expect(hover?.display).toMatchInlineSnapshot()` pins one promise. Snapshotting a whole result pins everything the editor said, so unrelated TypeScript changes break it.
- **Keep domain policy in your suite.** Your list of internal names, your documentation standard, your error-code prefix: these belong in a shared module of your tests, not in selenita.
