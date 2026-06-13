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
// Augmenting Vitest's `Matchers` extension point means importing
// `@mszr/selenita/vitest` types `expect.extend`, `expect(value).*`, and
// `expect.*` on Vitest 4. Extending `Assertion` as well keeps older Vitest
// versions in the peer range typed.

interface SelenitaVitestMatchers {
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

type SelenitaVitestAsymmetricMatchers = {
  [K in keyof Omit<SelenitaVitestMatchers, 'toHaveError'>]: SelenitaVitestMatchers[K] extends (...args: infer A) => any
    ? (...args: A) => any
    : never
} & {
  toHaveError: ((code: number, message?: RegExp) => any) & ((message: RegExp) => any)
}

declare module 'vitest' {
  // eslint-disable-next-line unused-imports/no-unused-vars
  interface Matchers<T = any> extends SelenitaVitestMatchers {}

  // eslint-disable-next-line unused-imports/no-unused-vars
  interface Assertion<T = any> extends SelenitaVitestMatchers {}

  interface AsymmetricMatchersContaining extends SelenitaVitestAsymmetricMatchers {}
}

// Re-export types so consumers of /vitest don't need a separate import
export type {
  CompletionItem,
  CompletionItemKind,
  Diagnostic,
  GroupCursorResult,
  SignatureHelp,
}
