import { expect, it } from 'vitest'
import { compareCompletions, createProject, cursor, snippet } from '../src/index'
import '../src/vitest'

it('requires two members in every runner, while allowing two empty sets', () => {
  for (const members of [{}, { first: ['apple'] }])
    expect(() => compareCompletions(members)).toThrow(/at least two members[\s\S]*hint:/)
  using project = createProject({ tsconfig: false })
  const result = project.query`${snippet`const fruit = { apple: 1 }; fruit.${cursor('member')}`.scope('first')}`
  expect(() => compareCompletions(result.atEach('member', []))).toThrow(/at least two members/)
  expect(compareCompletions({ first: [], second: [] })).toEqual({ hasParity: true, baseline: [], differences: {} })
  expect(compareCompletions({ first: ['apple'], second: ['kiwi'] }).hasParity).toBe(false)
  project.dispose()
  const unread = result.atEach('member', ['first'])
  expect(() => compareCompletions(unread)).toThrow(/at least two members/)
  expect(() => expect(unread).toHaveCompletionParity()).toThrow(/at least two members/)
})

it('compares sets independently of order and duplicate suggestions', () => {
  expect(compareCompletions({ first: ['a', 'b', 'a'], second: ['b', 'a'] })).toEqual({ hasParity: true, baseline: ['a', 'b'], differences: {} })
})
it('names added and missing suggestions relative to the most common set', () => {
  expect(compareCompletions({ minority: ['c'], first: ['a', 'b'], second: ['b', 'a'] })).toEqual({ hasParity: false, baseline: ['a', 'b'], differences: { minority: { added: ['c'], removed: ['a', 'b'] } } })
  expect(compareCompletions({ first: ['a'], second: ['b'] }).baseline).toEqual(['a'])
})
it('compares located observations and completion objects as well as names', () => {
  using project = createProject({ tsconfig: false })
  const result = project.query`const fruit = { apple: 1 }; ${snippet`fruit.${cursor('member')}`.scope('first')}; ${snippet`fruit.${cursor('member')}`.scope('second')}`
  expect(compareCompletions(result.atEach('member', ['first', 'second'])).hasParity).toBe(true)
  expect(compareCompletions({ first: result.at('first.member').completions, second: result.at('second.member').completionNames }).baseline).toEqual(['apple'])
})
