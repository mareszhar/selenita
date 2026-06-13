// Validates that importing @mszr/selenita/vitest augments Vitest's expect()
// return type with custom matchers. Run with: tsc --noEmit -p tests/consumer/tsconfig.json
// (requires a fresh build first)
import { expect } from 'vitest'
import '@mszr/selenita/vitest'

// Completion matchers
expect(['foo', 'bar']).toContainCompletion('foo')
expect(['foo', 'bar']).toContainCompletions(['foo', 'bar'])
expect(['foo', 'bar']).toEqualCompletions(['foo', 'bar'])

// Diagnostic matchers
expect([]).toBeClean()
expect([]).toHaveError(2339)
expect([]).toHaveError(/message/)
expect([]).toHaveError(2339, /message/)
expect([]).toHaveErrorCount(1)

// CompletionItem matchers
expect(undefined).toHaveKind('property')
expect(undefined).toHaveType('string')
expect(undefined).toHaveDocumentation(/docs/)
expect(undefined).toBeDeprecated()

// Parity matcher
expect({}).toHaveCompletionParity()

// Signature help matchers
expect(null).toBeActiveOnParameter(0)
expect(null).toHaveParameterCount(2)

// Type snapshot
expect('hover').toMatchTypeSnapshot()
expect('hover').toMatchTypeSnapshot('my-snapshot')

// Asymmetric matcher type-check
expect(['foo', 'bar']).toEqual(expect.toContainCompletion('foo'))
expect(['foo', 'bar']).toEqual(expect.not.toContainCompletion('foo'))
expect([]).toEqual(expect.toHaveError(2339))
expect([]).toEqual(expect.toHaveError(/message/))
expect([]).toEqual(expect.toHaveError(2339, /message/))
expect([]).toEqual(expect.not.toHaveError(2339))

export {}
