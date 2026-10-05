import type { Completion, CompletionComparison, Observations } from './types'
import { SelenitaError } from './errors'
import { freezeData } from './laziness'

export type CompletionReceiver = Observations | readonly Completion[] | readonly string[]
export function requireCompletionNames(received: CompletionReceiver): readonly string[] {
  if (Array.isArray(received)) {
    if (received.every(value => typeof value === 'string'))
      return received
    if (received.every(value => value && typeof value.name === 'string'))
      return received.map(value => value.name)
  }
  else if (received && 'completionNames' in received) {
    const names = received.completionNames
    if (Array.isArray(names) && names.every(name => typeof name === 'string'))
      return names
  }
  throw new SelenitaError('invalid completion receiver\n  hint: pass observations, completions, or completion names')
}
/** Compare completion sets as data, with the most common set as the baseline. */
export function compareCompletions(members: Readonly<Record<string, CompletionReceiver>>): CompletionComparison {
  const entries = Object.entries(members)
  if (entries.length < 2)
    throw new SelenitaError('completion parity needs at least two members\n  hint: list the expected scopes in result.atEach(name, scopes)')
  const sets = entries.map(([name, value]) => ({ name, names: new Set(requireCompletionNames(value)) }))
  const buckets = new Map<string, typeof sets>()
  for (const member of sets) {
    const key = JSON.stringify([...member.names].sort())
    const bucketMembers = buckets.get(key) ?? []
    bucketMembers.push(member)
    buckets.set(key, bucketMembers)
  }
  const majorityMembers = [...buckets.values()].sort((first, second) => second.length - first.length)[0]
  const baseline = majorityMembers?.[0]?.names ?? new Set<string>()
  const differences = Object.fromEntries(sets.flatMap((member) => {
    const added = [...member.names].filter(name => !baseline.has(name))
    const removed = [...baseline].filter(name => !member.names.has(name))
    return added.length || removed.length ? [[member.name, { added, removed }]] : []
  }))
  return freezeData({ hasParity: Object.keys(differences).length === 0, baseline: [...baseline], differences })
}
