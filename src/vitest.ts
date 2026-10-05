import type { ErrorOptions, SuggestOptions } from './matchers'
import type { Project, ProjectConfig } from './types'
import { afterAll, beforeAll, expect } from 'vitest'
import { SelenitaError } from './errors'
import * as matchers from './matchers'
import { createProject } from './project'

expect.extend({
  toSuggest(received, names: string | readonly string[], options?: SuggestOptions) {
    return matchers.toSuggest(received, names, options, { isNot: this.isNot })
  },
  toSuggestOnly(received, names: readonly string[]) {
    return matchers.toSuggestOnly(received, names, { isNot: this.isNot })
  },
  toHaveCompletionParity(received) {
    return matchers.toHaveCompletionParity(received, { isNot: this.isNot })
  },
  toBeClean(received) {
    return matchers.toBeClean(received, { isNot: this.isNot })
  },
  toHaveError(received, criterion: number | string | RegExp, messageOrOptions?: string | RegExp | ErrorOptions, options?: ErrorOptions) {
    return matchers.toHaveError(received, criterion, messageOrOptions, options, { isNot: this.isNot })
  },
  toHaveErrorCount(received, count: number) {
    return matchers.toHaveErrorCount(received, count, { isNot: this.isNot })
  },
})

interface SelenitaVitestMatchers<R> {
  /** Every name is suggested; negated, none is suggested. Optionally require non-blank documentation. */
  toSuggest: (names: string | readonly string[], options?: SuggestOptions) => R
  /** Suggested names equal these names as a set, ignoring order and duplicates. */
  toSuggestOnly: (names: readonly string[]) => R
  /** At least two members suggest the same set; differences are reported against a majority baseline. */
  toHaveCompletionParity: () => R
  /** No diagnostic has error severity. Warnings and suggestions do not count. */
  toBeClean: () => R
  /** Some error matches every criterion, including its exact underline when on is supplied. */
  toHaveError: {
    (code: number, options?: ErrorOptions): R
    (message: string | RegExp, options?: ErrorOptions): R
    (code: number, message: string | RegExp, options?: ErrorOptions): R
  }
  /** Exactly this many diagnostics have error severity. */
  toHaveErrorCount: (count: number) => R
}

declare module 'vitest' {
  // eslint-disable-next-line unused-imports/no-unused-vars
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown> extends SelenitaVitestMatchers<R> {}
}
export * from './index'

/** Declare a project whose warm-up and disposal belong to this Vitest scope. */
export function defineProject(...configs: ProjectConfig[]): Project {
  if (expect.getState().currentTestName)
    throw new SelenitaError('defineProject cannot run inside a test\n  hint: use createProject with using, or project.extend')
  const project = createProject(...configs)
  beforeAll(() => project.warmUp())
  afterAll(() => project.dispose())
  return project
}
