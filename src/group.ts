// ── Group primitive ─────────────────────────────────────────────────────────

export const GROUP_SENTINEL: unique symbol = Symbol.for('selenita.group')

export interface GroupValue {
  readonly [GROUP_SENTINEL]: true
  readonly label: string | null
  readonly members: readonly string[]
}

/**
 * Define a list of equivalent API expressions to test for completion parity.
 *
 * Pass the result to `project.queryGroup` to assert that every member exposes
 * the same completions, or to diagnose exactly what diverges.
 *
 * **Anonymous:**
 * ```ts
 * const queryApis = group(['db.queryOnce', 'db.useQuery', 'db.useInfiniteQuery'])
 * ```
 *
 * **Named** (label appears in failure output — purely cosmetic):
 * ```ts
 * const queryApis = group('queryApis', ['db.queryOnce', 'db.useQuery'])
 * ```
 *
 * Then use with `project.queryGroup`:
 * ```ts
 * const result = project.queryGroup(queryApis, api => snippet`${api}(${rootArg})`)`
 *   import { db } from './src'
 * `
 * expect(result.group.at('root')).toHaveCompletionParity()
 * ```
 */
export function group(members: readonly string[]): GroupValue
export function group(label: string, members: readonly string[]): GroupValue
export function group(
  labelOrMembers: string | readonly string[],
  maybeMembers?: readonly string[],
): GroupValue {
  if (Array.isArray(labelOrMembers)) {
    const value: GroupValue = {
      [GROUP_SENTINEL]: true as const,
      label: null,
      members: labelOrMembers as readonly string[],
    }
    return Object.freeze(value)
  }
  const value: GroupValue = {
    [GROUP_SENTINEL]: true as const,
    label: labelOrMembers as string,
    members: maybeMembers!,
  }
  return Object.freeze(value)
}

export function isGroup(value: unknown): value is GroupValue {
  return (
    value !== null
    && typeof value === 'object'
    && GROUP_SENTINEL in (value as object)
    && (value as Record<typeof GROUP_SENTINEL, unknown>)[GROUP_SENTINEL] === true
  )
}
