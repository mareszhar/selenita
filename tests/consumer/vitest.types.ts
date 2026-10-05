import type { Range } from '@mszr/selenita/vitest'
import { defineProject } from '@mszr/selenita/vitest'
import { expect } from 'vitest'

const project = defineProject({ tsconfig: false })
declare const range: Range
const names = ['apple', 'pear'] as const
expect(names).toSuggest('apple')
expect(names).toSuggest(names, { requireDocumentation: true })
expect(names).not.toSuggest(names)
expect(names).toSuggestOnly(names)
expect({ first: names, second: names }).toHaveCompletionParity()
expect([]).toBeClean()
expect([]).toHaveError(2322)
expect([]).toHaveError('message', { on: 'apple' })
expect([]).toHaveError(/message/, { on: range })
expect([]).toHaveError(2322, 'message')
expect([]).toHaveError(2322, /message/, { on: range })
expect([]).toHaveErrorCount(1)
expect.soft([]).not.toHaveError(2322)
const suggestionPromise: Promise<void> = expect(Promise.resolve(names)).resolves.toSuggest('apple')
const countPromise: Promise<void> = expect(Promise.resolve([])).resolves.toHaveErrorCount(0)
expect(names).toEqual(expect.toSuggest(names))
expect(names).toEqual(expect.not.toSuggest(names))
expect(names).toEqual(expect.toSuggestOnly(names))
expect({}).toEqual(expect.toHaveCompletionParity())
expect([]).toEqual(expect.toBeClean())
expect([]).toEqual(expect.toHaveError(2322, /message/, { on: range }))
expect([]).toEqual(expect.not.toHaveError(2322))
expect([]).toEqual(expect.toHaveErrorCount(1))
// @ts-expect-error names must be strings
expect([]).toSuggest(3)
// @ts-expect-error names must be an array
expect([]).toSuggestOnly('apple')
// @ts-expect-error parity takes no arguments
expect({}).toHaveCompletionParity(true)
// @ts-expect-error clean takes no arguments
expect([]).toBeClean(true)
// @ts-expect-error error criterion is required
expect([]).toHaveError()
// @ts-expect-error invalid underline
expect([]).toHaveError(2322, { on: 1 })
// @ts-expect-error count must be numeric
expect([]).toHaveErrorCount('one')
// @ts-expect-error removed matcher
expect([]).toContainCompletion('apple')
void [project, suggestionPromise, countPromise]
