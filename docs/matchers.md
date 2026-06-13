# Custom Matchers

Import `@mszr/selenita/vitest` once in your Vitest setup file. All matchers are then available on `expect` with full TypeScript types.

Make sure that setup file is included by your `tsconfig.json`. If your setup file lives outside `include`, either include it or append `@mszr/selenita/vitest` to `compilerOptions.types`:

```json
{
  "compilerOptions": {
    "types": ["vitest/globals", "@mszr/selenita/vitest"]
  }
}
```

If you already have a `types` array, keep the existing entries and add `@mszr/selenita/vitest`. You should not need to redeclare the matcher signatures yourself.

---

## Completions

```ts
// Applied to result.completions (string[])

expect(completions).toContainCompletion('table')
expect(completions).not.toContainCompletion('tabel')
expect(completions).toContainCompletions(['table', 'limit', 'orderBy'])

// Order-insensitive exact match
expect(completions).toEqualCompletions(['table', 'limit', 'orderBy'])
```

---

## CompletionItem

```ts
// Applied to result.completionItem('name') (CompletionItem | undefined)

expect(result.completionItem('table')).toHaveKind('property')
expect(result.completionItem('table')).toHaveType('string')
expect(result.completionItem('table')).toHaveDocumentation(/the target table/)
expect(result.completionItem('limit')).not.toBeDeprecated()
expect(result.completionItem('legacyField')).toBeDeprecated()
```

All `CompletionItem` matchers handle `undefined` gracefully — they fail with a clear message rather than throwing.

---

## Diagnostics

```ts
// Applied to result.errors or result.diagnostics (Diagnostic[])

expect(errors).toBeClean() // zero entries
expect(errors).toHaveError(2353) // by TypeScript error code
expect(errors).toHaveError(/known properties/) // by message regex
expect(errors).toHaveError(2353, /known properties/) // code AND message
expect(errors).toHaveErrorCount(1)
```

---

## Parity

```ts
// Applied to result.group.at('cursorName') (GroupCursorResult)
expect(result.group.at('filter')).toHaveCompletionParity()

// Applied to two string[] (for cross-position parity)
expect(result.at('list.filter').completions)
  .toEqualCompletions(result.at('single.filter').completions)
```

---

## Signature help

```ts
// Applied to result.signatureHelp (SignatureHelp | null)
expect(result.signatureHelp).toBeActiveOnParameter(0) // zero-indexed
expect(result.signatureHelp).toHaveParameterCount(2)
```

---

## Type snapshots

Store and compare type-level output in a separate snapshot file.

```ts
// Applied to result.hover, result.completionItems, or any serializable value
expect(result.hover).toMatchTypeSnapshot()
expect(result.completionItems).toMatchTypeSnapshot()

// Optional name to disambiguate multiple calls in the same test
expect(result.hover).toMatchTypeSnapshot('hover-text')
```

Snapshots are stored in `__type_snapshots__/<test-file>.type-snapshot` adjacent to the test file, where the full test filename including extension is preserved — e.g. `api.test.ts` → `api.test.ts.type-snapshot`. Update them by running:

```sh
vitest run --update
# or set VITEST_UPDATE_SNAPSHOT=all
```
