import type { Fixture, FixtureMarker } from './fixture'
import type { CompletionReceiver } from './parity'
import type { Completion, Diagnostic, Range } from './types'
import { resolve } from 'node:path'
import { SelenitaError } from './errors'
import { compareCompletions, requireCompletionNames } from './parity'
import { createRange, fixtureReference, formatExcerpt, markerReference } from './ranges'

interface MatcherContext { isNot: boolean }
interface MatcherJudgment { pass: boolean, message: () => string }
export interface SuggestOptions { requireDocumentation?: boolean }
export interface ErrorOptions { on?: string | Range }
interface LocatedReceiver { [fixtureReference]?: Fixture, [markerReference]?: FixtureMarker }

function requireNames(received: unknown): readonly string[] {
  if (Array.isArray(received) && received.every(value => typeof value === 'string' || (value && typeof value.name === 'string')))
    return requireCompletionNames(received)
  if (received && typeof received === 'object' && 'completionNames' in received) {
    const names = received.completionNames
    if (Array.isArray(names) && names.every(name => typeof name === 'string'))
      return names
  }
  throw new SelenitaError(`suggest matcher received ${typeof received}; expects observations, completion objects, or name arrays\n  hint: pass result.at(name), result.completions, or result.completionNames`)
}
function requireCompletions(received: unknown): readonly Completion[] {
  const completions = received && typeof received === 'object' && 'completions' in received ? received.completions : received
  if (Array.isArray(completions) && completions.every(value => value && typeof value.name === 'string' && 'documentation' in value))
    return completions
  throw new SelenitaError('requireDocumentation expects completion objects\n  hint: pass observations or completions instead of completionNames')
}
function requireErrors(received: unknown): readonly Diagnostic[] {
  const diagnostics = received && typeof received === 'object' && 'errors' in received ? received.errors : received
  if (Array.isArray(diagnostics) && diagnostics.every(value => value && typeof value.code === 'number' && typeof value.message === 'string' && typeof value.severity === 'string'))
    return diagnostics.filter(value => value.severity === 'error')
  throw new SelenitaError(`report matcher received ${typeof received}; expects a result or diagnostic array\n  hint: pass result, result.errors, or result.diagnostics`)
}
function formatNames(names: readonly string[]): string {
  return names.slice(0, 20).join(', ') + (names.length > 20 ? ` (${names.length - 20} more)` : '')
}
function formatLocation(received: unknown): { label: string, excerpt: string } {
  const located = received as LocatedReceiver | null
  const fixture = located?.[fixtureReference]
  const marker = located?.[markerReference]
  if (!fixture || !marker)
    return { label: 'cursor', excerpt: '' }
  const range = createRange(fixture.root, marker.file, fixture.files.get(marker.file)!.text, marker.start, marker.end - marker.start, fixture)
  return { label: `${marker.kind}${marker.name ? ` '${marker.name}'` : ''}`, excerpt: `\n${formatExcerpt(range)}` }
}
function formatErrors(errors: readonly Diagnostic[]): string {
  return errors.map(error => `  [${error.code}] ${error.message}${error.range ? `\n${formatExcerpt(error.range)}` : ''}`).join('\n') || '  errors: none'
}

export function toSuggest(received: unknown, expected: string | readonly string[], options: SuggestOptions | undefined, context: MatcherContext): MatcherJudgment {
  if (options?.requireDocumentation && context.isNot)
    throw new SelenitaError('requireDocumentation cannot be negated\n  hint: check documentation positively, or negate toSuggest without this option')
  const requestedNames = typeof expected === 'string' ? [expected] : expected
  const names = requireNames(received)
  const missingNames = requestedNames.filter(name => !names.includes(name))
  const presentNames = requestedNames.filter(name => names.includes(name))
  const undocumentedNames = options?.requireDocumentation
    ? [...new Set(requireCompletions(received).filter(completion => requestedNames.includes(completion.name) && !completion.documentation.trim()).map(completion => completion.name))]
    : []
  const location = formatLocation(received)
  const message = `expected ${location.label} to suggest ${context.isNot ? 'none of' : 'all of'} ${formatNames(requestedNames)}${location.excerpt}${
    context.isNot ? `\n  suggested anyway: ${formatNames(presentNames)}` : `${missingNames.length ? `\n  missing: ${formatNames(missingNames)}` : ''}${undocumentedNames.length ? `\n  undocumented: ${formatNames(undocumentedNames)}` : ''}`
  }\n  suggested (${names.length}): ${formatNames(names)}`
  return { pass: context.isNot ? presentNames.length > 0 : missingNames.length === 0 && undocumentedNames.length === 0, message: () => message }
}
export function toSuggestOnly(received: unknown, expected: readonly string[], context: MatcherContext): MatcherJudgment {
  const names = [...new Set(requireNames(received))]
  const requestedNames = [...new Set(expected)]
  const missingNames = requestedNames.filter(name => !names.includes(name))
  const unexpectedNames = names.filter(name => !requestedNames.includes(name))
  const location = formatLocation(received)
  const message = `expected ${location.label} ${context.isNot ? 'not ' : ''}to suggest exactly ${formatNames(requestedNames)}${location.excerpt}\n  missing: ${formatNames(missingNames)}\n  unexpected: ${formatNames(unexpectedNames)}`
  return { pass: missingNames.length === 0 && unexpectedNames.length === 0, message: () => message }
}
export function toHaveCompletionParity(received: unknown, context: MatcherContext): MatcherJudgment {
  if (!received || typeof received !== 'object' || Array.isArray(received))
    throw new SelenitaError('parity matcher expects a record of observations or completion arrays\n  hint: pass result.atEach(name, scopes)')
  const members = Object.entries(received)
  const comparison = compareCompletions(received as Record<string, CompletionReceiver>)
  const baselineMembers = Object.keys(received).filter(name => !Object.hasOwn(comparison.differences, name))
  const location = formatLocation(members[0]![1])
  const message = `expected ${context.isNot ? 'different completion sets' : 'completion parity'} across ${members.length} members at ${location.label}${location.excerpt}\n  baseline (${baselineMembers.join(', ')}): ${formatNames(comparison.baseline)}\n${
    Object.entries(comparison.differences).map(([name, difference]) => `  ${name}:${difference.added.length ? ` +${formatNames(difference.added)}` : ''}${difference.removed.length ? `  -${formatNames(difference.removed)}` : ''}`).join('\n')}`
  return { pass: comparison.hasParity, message: () => message }
}
export function toBeClean(received: unknown, context: MatcherContext): MatcherJudgment {
  const errors = requireErrors(received)
  const message = `expected ${context.isNot ? 'at least one error' : 'no errors'}\n${formatErrors(errors)}`
  return { pass: errors.length === 0, message: () => message }
}
export function toHaveErrorCount(received: unknown, expected: number, context: MatcherContext): MatcherJudgment {
  const errors = requireErrors(received)
  const message = `expected ${context.isNot ? 'not ' : ''}${expected} errors, received ${errors.length}\n${formatErrors(errors)}`
  return { pass: errors.length === expected, message: () => message }
}
function compareMessage(message: string, pattern: string | RegExp | undefined): boolean {
  return pattern === undefined || (typeof pattern === 'string' ? message.includes(pattern) : new RegExp(pattern.source, pattern.flags).test(message))
}
function compareRange(range: Range | null, expected: string | Range | undefined): boolean {
  if (expected === undefined)
    return true
  if (!range)
    return false
  if (typeof expected === 'string')
    return range.text === expected
  return range.file === expected.file && (['start', 'end'] as const).every(point => (['line', 'column', 'offset'] as const).every(key => range[point][key] === expected[point][key]))
}
function formatNearMiss(actual: Range, expected: string | Range): string {
  const fixture = (actual as Range & LocatedReceiver)[fixtureReference]
  let range = typeof expected === 'string' ? undefined : expected
  if (fixture) {
    const file = resolve(fixture.root, typeof expected === 'string' ? actual.file : expected.file)
    const text = fixture.files.get(file)?.text
    if (text !== undefined) {
      const offset = typeof expected === 'string' ? text.indexOf(expected, Math.max(0, actual.start.offset - expected.length)) : expected.start.offset
      if (offset >= 0)
        range = createRange(fixture.root, file, text, offset, typeof expected === 'string' ? expected.length : expected.end.offset - offset, fixture)
    }
  }
  return `\n  expected underline${range ? `\n${formatExcerpt(range)}` : `: '${expected}'`}\n  actual underline\n${formatExcerpt(actual)}`
}
export function toHaveError(received: unknown, criterion: number | string | RegExp, messageOrOptions: string | RegExp | ErrorOptions | undefined, options: ErrorOptions | undefined, context: MatcherContext): MatcherJudgment {
  const errors = requireErrors(received)
  const code = typeof criterion === 'number' ? criterion : undefined
  const pattern = code === undefined ? criterion as string | RegExp : typeof messageOrOptions === 'string' || messageOrOptions instanceof RegExp ? messageOrOptions : undefined
  const location = messageOrOptions && typeof messageOrOptions === 'object' && !(messageOrOptions instanceof RegExp) ? messageOrOptions.on : options?.on
  const nearMatches = errors.filter(error => (code === undefined || code === error.code) && compareMessage(error.message, pattern))
  const hasMatch = nearMatches.some(error => compareRange(error.range, location))
  const nearMiss = !hasMatch && location !== undefined ? nearMatches.find(error => error.range) : undefined
  const message = `expected ${context.isNot ? 'no ' : ''}error ${code ?? ''}${pattern === undefined ? '' : ` matching ${String(pattern)}`}${location === undefined ? '' : ` on '${typeof location === 'string' ? location : location.text}'`}${
    nearMiss?.range ? formatNearMiss(nearMiss.range, location!) : ''}\n${formatErrors(errors)}`
  return { pass: hasMatch, message: () => message }
}
