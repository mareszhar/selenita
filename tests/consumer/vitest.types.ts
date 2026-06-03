// Validates that importing @mszr/selenita/vitest augments Vitest's Assertion<T>
// with custom matchers. Run with: tsc --noEmit -p tests/consumer/tsconfig.json
// (requires a fresh build first)
import type { Assertion } from 'vitest'
import '@mszr/selenita/vitest'

declare const stringArray: Assertion<string[]>
declare const anyValue: Assertion<unknown>

// Completion matchers
stringArray.toContainCompletion('foo')
stringArray.toContainCompletions(['foo', 'bar'])
stringArray.toEqualCompletions(['foo', 'bar'])

// Diagnostic matchers
anyValue.toBeClean()
anyValue.toHaveError(2339)
anyValue.toHaveError(/message/)
anyValue.toHaveError(2339, /message/)
anyValue.toHaveErrorCount(1)

// CompletionItem matchers
anyValue.toHaveKind('property')
anyValue.toHaveType('string')
anyValue.toHaveDocumentation(/docs/)
anyValue.toBeDeprecated()

// Parity matcher
anyValue.toHaveCompletionParity()

// Signature help matchers
anyValue.toBeActiveOnParameter(0)
anyValue.toHaveParameterCount(2)

// Type snapshot
anyValue.toMatchTypeSnapshot()
anyValue.toMatchTypeSnapshot('my-snapshot')

export {}
