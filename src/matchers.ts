import type { CompletionItem, CompletionItemKind, Diagnostic, GroupCursorResult, SignatureHelp } from './types'
import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'

// ── Type-snapshot helpers ───────────────────────────────────────────────────

const SNAPSHOT_DIR = '__type_snapshots__'
const SNAPSHOT_EXT = '.type-snapshot'

/**
 * Derive the absolute path to the snapshot file for the given test file.
 * e.g. /project/tests/api.test.ts → /project/tests/__type_snapshots__/api.test.type-snapshot
 */
function snapshotFilePath(testFilePath: string): string {
  const dir = path.dirname(testFilePath)
  const base = path.basename(testFilePath)
  return path.join(dir, SNAPSHOT_DIR, base + SNAPSHOT_EXT)
}

/** Extract the calling test file path from a stack trace. */
function callerTestFile(stackOffset = 4): string | undefined {
  const err = new Error('stack capture')
  const lines = (err.stack ?? '').split('\n').slice(stackOffset)
  for (const line of lines) {
    // Match absolute paths ending in a test-file extension
    const m = line.match(/\((.+\.(test|spec)\.[cm]?[tj]sx?):\d+:\d+\)/)
      ?? line.match(/at (.+\.(test|spec)\.[cm]?[tj]sx?):\d+:\d+/)
    if (m?.[1])
      return m[1]
  }
  return undefined
}

type SnapshotMap = Record<string, string>

function readSnapshotFile(filePath: string): SnapshotMap {
  if (!fs.existsSync(filePath))
    return {}
  const raw = fs.readFileSync(filePath, 'utf-8')
  try {
    return JSON.parse(raw) as SnapshotMap
  }
  catch {
    throw new Error(
      `selenita toMatchTypeSnapshot: snapshot file is not valid JSON.\n`
      + `File: ${filePath}\n`
      + `Run with vitest --update (-u) to regenerate it.`,
    )
  }
}

function writeSnapshotFile(filePath: string, data: SnapshotMap): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf-8')
}

function serializeForSnapshot(value: unknown): string {
  const result = JSON.stringify(value, null, 2)
  if (result === undefined) {
    throw new Error(
      `selenita toMatchTypeSnapshot: received value cannot be serialized to JSON (got ${typeof value}).\n`
      + `Only JSON-serializable values (objects, arrays, strings, numbers, booleans, null) are supported.`,
    )
  }
  return result
}

function isUpdateMode(): boolean {
  // Vitest: `--update` / `-u` flag sets updateSnapshot='all' in the worker config.
  // `VITEST_UPDATE_SNAPSHOT=all` is also accepted as an explicit manual override.
  if (process.env.VITEST_UPDATE_SNAPSHOT === 'all')
    return true
  const vitestWorker = (globalThis as {
    __vitest_worker__?: { config?: { snapshotOptions?: { updateSnapshot?: string } } }
  }).__vitest_worker__
  if (vitestWorker?.config?.snapshotOptions?.updateSnapshot === 'all')
    return true
  return false
}

function snapshotUpdateHint(): string {
  return 'Run with vitest --update (or -u) to update.'
}

// ── Matcher builder ─────────────────────────────────────────────────────────

/**
 * Build the selenita custom matcher set.
 * Returns an object suitable for `expect.extend(...)`.
 */

export function buildMatchers() {
  return {
    // ── Completion matchers ─────────────────────────────────────────────────

    toContainCompletion(this: unknown, received: string[], expected: string) {
      const pass = received.includes(expected)
      return {
        pass,
        message: () =>
          pass
            ? `Expected completions not to contain '${expected}', but it did.\nCompletions: ${JSON.stringify(received)}`
            : `Expected completions to contain '${expected}'.\nCompletions: ${JSON.stringify(received)}`,
      }
    },

    toContainCompletions(this: unknown, received: string[], expected: string[]) {
      const missing = expected.filter(e => !received.includes(e))
      const pass = missing.length === 0
      return {
        pass,
        message: () =>
          pass
            ? `Expected completions not to contain all of ${JSON.stringify(expected)}, but they did.`
            : `Expected completions to contain ${JSON.stringify(missing)}.\nCompletions: ${JSON.stringify(received)}`,
      }
    },

    toEqualCompletions(this: unknown, received: string[], expected: string[]) {
      const sortedReceived = [...received].sort()
      const sortedExpected = [...expected].sort()
      const pass = JSON.stringify(sortedReceived) === JSON.stringify(sortedExpected)
      return {
        pass,
        message: () =>
          pass
            ? `Expected completions not to equal ${JSON.stringify(sortedExpected)} (order-insensitive).`
            : `Expected completions to equal ${JSON.stringify(sortedExpected)} (order-insensitive).\nReceived: ${JSON.stringify(sortedReceived)}`,
      }
    },

    // ── CompletionItem matchers ─────────────────────────────────────────────

    toHaveKind(this: unknown, received: CompletionItem | undefined, expected: CompletionItemKind) {
      if (!received) {
        return {
          pass: false,
          message: () => `Expected a CompletionItem but got undefined.`,
        }
      }
      const pass = received.kind === expected
      return {
        pass,
        message: () =>
          pass
            ? `Expected CompletionItem '${received.name}' not to have kind '${expected}'.`
            : `Expected CompletionItem '${received.name}' to have kind '${expected}', but got '${received.kind}'.`,
      }
    },

    toHaveType(this: unknown, received: CompletionItem | undefined, expected: string) {
      if (!received) {
        return {
          pass: false,
          message: () => `Expected a CompletionItem but got undefined.`,
        }
      }
      const pass = received.type.includes(expected)
      return {
        pass,
        message: () =>
          pass
            ? `Expected CompletionItem '${received.name}' type not to include '${expected}'.`
            : `Expected CompletionItem '${received.name}' type to include '${expected}'.\nType: ${received.type}`,
      }
    },

    toHaveDocumentation(this: unknown, received: CompletionItem | undefined, expected: string | RegExp) {
      if (!received) {
        return {
          pass: false,
          message: () => `Expected a CompletionItem but got undefined.`,
        }
      }
      const pass
        = typeof expected === 'string'
          ? received.documentation.includes(expected)
          : expected.test(received.documentation)
      return {
        pass,
        message: () =>
          pass
            ? `Expected documentation not to match ${String(expected)}.`
            : `Expected documentation to match ${String(expected)}.\nDocumentation: ${received.documentation}`,
      }
    },

    toBeDeprecated(this: unknown, received: CompletionItem | undefined) {
      if (!received) {
        return {
          pass: false,
          message: () => `Expected a CompletionItem but got undefined.`,
        }
      }
      return {
        pass: received.isDeprecated,
        message: () =>
          received.isDeprecated
            ? `Expected CompletionItem '${received.name}' not to be deprecated.`
            : `Expected CompletionItem '${received.name}' to be deprecated.`,
      }
    },

    // ── Diagnostic matchers ─────────────────────────────────────────────────

    toBeClean(this: unknown, received: Diagnostic[]) {
      const errors = received.filter(d => d.severity === 'error')
      const pass = errors.length === 0
      return {
        pass,
        message: () =>
          pass
            ? `Expected errors not to be clean, but there were none.`
            : `Expected no errors, but got:\n${errors.map(d => `  [${d.code}] ${d.message}`).join('\n')}`,
      }
    },

    toHaveError(
      this: unknown,
      received: Diagnostic[],
      codeOrMessage: number | RegExp,
      message?: RegExp,
    ) {
      const errors = received.filter(d => d.severity === 'error')
      const matchesCode = (d: Diagnostic) =>
        typeof codeOrMessage === 'number' ? d.code === codeOrMessage : true
      const matchesMessage = (d: Diagnostic) => {
        if (typeof codeOrMessage === 'object')
          return codeOrMessage.test(d.message)
        if (message)
          return message.test(d.message)
        return true
      }
      const pass = errors.some(d => matchesCode(d) && matchesMessage(d))
      return {
        pass,
        message: () => {
          const desc
            = typeof codeOrMessage === 'number'
              ? message
                ? `code ${codeOrMessage} matching ${message}`
                : `code ${codeOrMessage}`
              : `message matching ${codeOrMessage}`
          return pass
            ? `Expected errors not to have error with ${desc}.`
            : `Expected errors to have error with ${desc}.\nErrors:\n${errors.map(d => `  [${d.code}] ${d.message}`).join('\n')}`
        },
      }
    },

    toHaveErrorCount(this: unknown, received: Diagnostic[], expected: number) {
      const errors = received.filter(d => d.severity === 'error')
      const pass = errors.length === expected
      return {
        pass,
        message: () =>
          pass
            ? `Expected not to have exactly ${expected} error(s).`
            : `Expected ${expected} error(s), but got ${errors.length}.\nErrors:\n${errors.map(d => `  [${d.code}] ${d.message}`).join('\n')}`,
      }
    },

    // ── Parity matcher ──────────────────────────────────────────────────────

    toHaveCompletionParity(this: unknown, received: GroupCursorResult) {
      const pass = received.hasParity
      return {
        pass,
        message: () => {
          const groupTag = received.label ? ` (group: ${received.label})` : ''
          if (pass)
            return `Expected group cursor result${groupTag} not to have completion parity.`

          const { divergence } = received
          if (!divergence)
            return `No divergence data available.`

          const lines = [`Expected all group members to have identical completions${groupTag}.\nBaseline: ${JSON.stringify(divergence.baseline)}`]
          for (const [api, diff] of Object.entries(divergence.members)) {
            if (diff.added.length || diff.removed.length) {
              lines.push(
                `  ${api}:${diff.added.length ? ` +[${diff.added.join(', ')}]` : ''}${diff.removed.length ? ` -[${diff.removed.join(', ')}]` : ''}`,
              )
            }
          }
          return lines.join('\n')
        },
      }
    },

    // ── Signature help matchers ─────────────────────────────────────────────

    toBeActiveOnParameter(this: unknown, received: SignatureHelp | null, expected: number) {
      if (!received) {
        return {
          pass: false,
          message: () => `Expected SignatureHelp to be present but got null.`,
        }
      }
      const pass = received.activeParameter === expected
      return {
        pass,
        message: () =>
          pass
            ? `Expected active parameter not to be ${expected}.`
            : `Expected active parameter to be ${expected}, but got ${received.activeParameter}.`,
      }
    },

    toHaveParameterCount(this: unknown, received: SignatureHelp | null, expected: number) {
      if (!received) {
        return {
          pass: false,
          message: () => `Expected SignatureHelp to be present but got null.`,
        }
      }
      const activeSignature = received.signatures[received.activeSignature]
      const count = activeSignature?.parameters.length ?? 0
      const pass = count === expected
      return {
        pass,
        message: () =>
          pass
            ? `Expected signature not to have ${expected} parameter(s).`
            : `Expected signature to have ${expected} parameter(s), but got ${count}.`,
      }
    },

    // ── Type snapshots ──────────────────────────────────────────────────────

    /**
     * Assert that the received value matches a stored type snapshot.
     *
     * Snapshots are stored in `__type_snapshots__/<test-file>.type-snapshot`
     * adjacent to the test file. Pass an optional `name` to disambiguate
     * multiple calls in the same test.
     *
     * Update snapshots: run with `vitest --update` (or `-u`), or set `VITEST_UPDATE_SNAPSHOT=all`.
     */
    toMatchTypeSnapshot(this: { currentTestName?: string }, received: unknown, name?: string) {
      const serialized = serializeForSnapshot(received)
      const testFile = callerTestFile()

      if (!testFile) {
        return {
          pass: false,
          message: () =>
            `selenita toMatchTypeSnapshot: could not determine test file path from the stack trace.\n`
            + `Ensure this matcher is called from within a .test.ts or .spec.ts file.`,
        }
      }

      const snapshotKey = [this.currentTestName, name].filter(Boolean).join(' > ') || 'default'
      const snapshotPath = snapshotFilePath(testFile)
      const snapshots = readSnapshotFile(snapshotPath)

      if (isUpdateMode() || !(snapshotKey in snapshots)) {
        snapshots[snapshotKey] = serialized
        writeSnapshotFile(snapshotPath, snapshots)
        return { pass: true, message: () => '' }
      }

      const stored = snapshots[snapshotKey] ?? ''
      const pass = serialized === stored

      return {
        pass,
        message: () =>
          pass
            ? `Expected type snapshot not to match '${snapshotKey}'.`
            : `Type snapshot mismatch for '${snapshotKey}'.\nExpected:\n${stored}\n\nReceived:\n${serialized}\n\n${snapshotUpdateHint()}`,
      }
    },
  }
}
