import type { CompletionItem, CompletionItemKind, Diagnostic, GroupCursorResult, SignatureHelp } from './types'
/**
 * selenita/vitest — custom matchers for Vitest.
 *
 * Add to your Vitest setup file:
 *   import '@mszr/selenita/vitest'
 *
 * Then in vitest.config.ts:
 *   test: { setupFiles: ['./vitest.setup.ts'] }
 */
import { expect } from 'vitest'
import { buildMatchers } from './matchers'

expect.extend(buildMatchers())

// ── Vitest type augmentation ────────────────────────────────────────────────
// Augmenting the `vitest` module here means that importing `@mszr/selenita/vitest`
// is all a user needs — the custom matcher types are automatically included.

declare module 'vitest' {
  // eslint-disable-next-line unused-imports/no-unused-vars
  interface Assertion<T> {
    // Completions
    toContainCompletion: (name: string) => void
    toContainCompletions: (names: string[]) => void
    /** Order-insensitive exact match on `completions`. */
    toEqualCompletions: (names: string[]) => void

    // CompletionItem
    toHaveKind: (kind: CompletionItemKind) => void
    toHaveType: (type: string) => void
    toHaveDocumentation: (doc: string | RegExp) => void
    toBeDeprecated: () => void

    // Diagnostics
    toBeClean: () => void
    toHaveError: ((code: number, message?: RegExp) => void) & ((message: RegExp) => void)
    toHaveErrorCount: (count: number) => void

    // Parity
    /** Assert that all group members expose identical completions (order-insensitive). */
    toHaveCompletionParity: () => void

    // Signature help
    toBeActiveOnParameter: (index: number) => void
    toHaveParameterCount: (count: number) => void

    // Type snapshots
    /** Store or compare a type-level snapshot in `__type_snapshots__/`. */
    toMatchTypeSnapshot: (name?: string) => void
  }

  interface AsymmetricMatchersContaining {
    toContainCompletion: (name: string) => unknown
    toContainCompletions: (names: string[]) => unknown
    toEqualCompletions: (names: string[]) => unknown
    toHaveKind: (kind: CompletionItemKind) => unknown
    toHaveType: (type: string) => unknown
    toBeClean: () => unknown
    toHaveCompletionParity: () => unknown
  }
}

// Re-export types so consumers of /vitest don't need a separate import
export type {
  CompletionItem,
  CompletionItemKind,
  Diagnostic,
  GroupCursorResult,
  SignatureHelp,
}
