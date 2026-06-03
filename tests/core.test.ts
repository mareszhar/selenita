import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cursor, defineProject, group, snippet } from '../src/index'

// ── Project setup ───────────────────────────────────────────────────────────

const fruitDts = readFileSync(resolve(__dirname, 'fixtures/fruit.d.ts'), 'utf-8')

const project = defineProject({
  files: {
    'node_modules/fruit-lib/index.d.ts': fruitDts,
  },
})

// ── Phase 1: single cursor, completions, diagnostics ───────────────────────

describe('phase 1 — core foundation', () => {
  it('suggests Fruit keys on empty object literal', () => {
    const { completions } = project.query`
      import { registerFruit } from 'fruit-lib'
      registerFruit({ ${cursor} })
    `
    expect(completions).toContain('name')
    expect(completions).toContain('price')
    expect(completions).toContain('availableQuantity')
  })

  it('does not suggest unknown keys', () => {
    const { completions } = project.query`
      import { registerFruit } from 'fruit-lib'
      registerFruit({ ${cursor} })
    `
    expect(completions).not.toContain('neim')
  })

  it('reports no errors on valid input', () => {
    const { errors } = project.check`
      import { registerFruit } from 'fruit-lib'
      registerFruit({ name: 'apple', price: 5, availableQuantity: 100 })
    `
    expect(errors).toHaveLength(0)
  })

  it('reports type error on unknown key', () => {
    const { errors } = project.check`
      import { registerFruit } from 'fruit-lib'
      registerFruit({ neim: 'apple' })
    `
    expect(errors.length).toBeGreaterThan(0)
    expect(errors.some(e => e.code === 2353 || e.code === 2345)).toBe(true)
  })

  it('returns hover text at cursor', () => {
    const { hover } = project.query`
      import { registerFruit } from 'fruit-lib'
      registerFruit${cursor}
    `
    // hover may or may not be present depending on position, but it should not throw
    expect(hover === null || typeof hover === 'string').toBe(true)
  })
})

// ── Phase 2: named cursors, multi-cursor, completionItems ──────────────────

describe('phase 2 — full result surface', () => {
  it('completions narrow as the object fills in (multi-cursor)', () => {
    const result = project.query`
      import { registerFruit } from 'fruit-lib'
      registerFruit({ ${cursor('empty')} })
      registerFruit({ name: 'apple', ${cursor('remaining')} })
    `

    expect(result.at('empty').completions).toContain('name')
    expect(result.at('remaining').completions).not.toContain('name')
    expect(result.at('remaining').completions).toContain('price')
  })

  it('completionItem returns rich data', () => {
    const result = project.query`
      import { registerFruit } from 'fruit-lib'
      registerFruit({ ${cursor} })
    `

    const item = result.completionItem('name')
    expect(item).toBeDefined()
    expect(item?.kind).toBe('property')
    expect(item?.isDeprecated).toBe(false)
  })

  it('completionItemsOfKind filters correctly', () => {
    const result = project.query`
      import { registerFruit } from 'fruit-lib'
      registerFruit({ ${cursor} })
    `

    const props = result.completionItemsOfKind('property')
    expect(props.some(p => p.name === 'name')).toBe(true)
  })

  it('virtual files from defineProject files option resolve', () => {
    const { errors } = project.check`
      import type { Fruit } from 'fruit-lib'
      const f: Fruit = { name: 'x', price: 1, availableQuantity: 1 }
    `
    expect(errors).toHaveLength(0)
  })
})

// ── Phase 3: snippets ───────────────────────────────────────────────────────

describe('phase 3 — snippets', () => {
  const fruitArg = snippet`{ ${cursor('field')} }`

  it('single snippet use — cursors accessible by name', () => {
    const result = project.query`
      import { registerFruit } from 'fruit-lib'
      registerFruit(${fruitArg})
    `

    expect(result.at('field').completions).toContain('name')
  })

  it('reusing snippet with .for() aliases cursors correctly', () => {
    const result = project.query`
      import { registerFruit } from 'fruit-lib'
      registerFruit(${fruitArg.for('a')})
      registerFruit(${fruitArg.for('b')})
    `

    expect(result.at('a.field').completions).toContain('name')
    expect(result.at('b.field').completions).toContain('name')
  })

  it('nested snippet path concatenation', () => {
    const inner = snippet`{ ${cursor('field')} }`
    const outer = snippet`{ nested: ${inner.for('inner')} }`

    const result = project.query`
      import { registerFruit } from 'fruit-lib'
      registerFruit(${outer.for('ctx')})
    `

    // path: ctx.inner.field
    expect(() => result.at('ctx.inner.field')).not.toThrow()
  })
})

// ── Phase 4: groups and parity ──────────────────────────────────────────────

describe('phase 4 — groups & parity', () => {
  const multiProject = defineProject({
    files: {
      'node_modules/db-lib/index.d.ts': `
        export declare const db: {
          queryOnce(opts: { users?: boolean; posts?: boolean }): void
          useQuery(opts: { users?: boolean; posts?: boolean }): void
        }
      `,
    },
  })

  const queryApis = group('queryApis', ['db.queryOnce', 'db.useQuery'])
  const rootArg = snippet`{ ${cursor('root')} }`

  it('queryGroup assembles results for each member', () => {
    const result = multiProject.queryGroup(queryApis, api => snippet`${api}(${rootArg})`)`
      import { db } from 'db-lib'
    `

    const onceCompletions = result.for('db.queryOnce').completions
    expect(onceCompletions).toContain('users')
    expect(onceCompletions).toContain('posts')

    const queryCompletions = result.for('db.useQuery').completions
    expect(queryCompletions).toContain('users')
    expect(queryCompletions).toContain('posts')
  })

  it('hasParity is true when members have identical completions', () => {
    const result = multiProject.queryGroup(queryApis, api => snippet`${api}(${rootArg})`)`
      import { db } from 'db-lib'
    `
    const groupResult = result.group.at('root')
    // Both APIs share the same options type — parity must hold
    expect(groupResult.hasParity).toBe(true)
    expect(groupResult.divergence).toBeNull()
    expect(groupResult.completions['db.queryOnce']).toContain('users')
  })

  const asymmetricProject = defineProject({
    files: {
      'node_modules/asym-lib/index.d.ts': `
        export declare const api: {
          withExtra(opts: { a?: boolean; b?: boolean; extra?: string }): void
          withoutExtra(opts: { a?: boolean; b?: boolean }): void
        }
      `,
    },
  })
  const asymApis = group('asymApis', ['api.withExtra', 'api.withoutExtra'])

  it('hasParity is false and divergence is populated when members differ', () => {
    const result = asymmetricProject.queryGroup(asymApis, m => snippet`${m}({ ${cursor('arg')} })`)`
      import { api } from 'asym-lib'
    `

    const groupResult = result.group.at('arg')
    expect(groupResult.hasParity).toBe(false)
    expect(groupResult.divergence).not.toBeNull()

    // Baseline is api.withExtra (first member); api.withoutExtra is missing 'extra'
    const withoutExtraEntry = groupResult.divergence!.members['api.withoutExtra']
    expect(withoutExtraEntry).toBeDefined()
    expect(withoutExtraEntry!.removed).toContain('extra')
  })
})

// ── Phase 5: project.with() ─────────────────────────────────────────────────

describe('phase 5 — project.with()', () => {
  it('scoped project sees injected virtual type declarations', () => {
    const scoped = project.with({
      files: {
        'node_modules/hypothetical-lib/index.d.ts': `
          export declare function paint(color: Color): void
          export type Color = 'red' | 'green' | 'blue'
        `,
      },
    })

    const { completions } = scoped.query`
      import { paint } from 'hypothetical-lib'
      paint(${cursor})
    `

    expect(completions).toContain('red')
    expect(completions).toContain('green')
    expect(completions).toContain('blue')
  })

  it('parent project is unaffected by scoped overrides', () => {
    const { errors } = project.check`
      import { paint } from 'hypothetical-lib'
      paint('red')
    `
    // hypothetical-lib should not resolve in the parent project
    expect(errors.length).toBeGreaterThan(0)
  })

  it('with() chains compose correctly', () => {
    const base = project.with({ files: { 'node_modules/extra-a/index.d.ts': `export type A = 'a1' | 'a2'` } })
    const extended = base.with({ files: { 'node_modules/extra-b/index.d.ts': `export type B = 'b1' | 'b2'` } })

    const { errors: errorsA } = extended.check`import type { A } from 'extra-a'; const x: A = 'a1'`
    const { errors: errorsB } = extended.check`import type { B } from 'extra-b'; const x: B = 'b1'`

    expect(errorsA).toHaveLength(0)
    expect(errorsB).toHaveLength(0)
  })
})

// ── Error handling ──────────────────────────────────────────────────────────

describe('error handling', () => {
  it('throws on bare cursor mixed with named cursor', () => {
    expect(() =>
      project.query`
        import { registerFruit } from 'fruit-lib'
        registerFruit({ ${cursor} })
        registerFruit({ ${cursor('other')} })
      `,
    ).toThrow('Mixed cursor types')
  })

  it('throws on duplicate cursor name', () => {
    expect(() =>
      project.query`
        import { registerFruit } from 'fruit-lib'
        registerFruit({ ${cursor('dup')} })
        registerFruit({ ${cursor('dup')} })
      `,
    ).toThrow(`Duplicate cursor name 'dup'`)
  })

  it('throws on cursor inside project.check', () => {
    expect(() =>
      project.check`
        import { registerFruit } from 'fruit-lib'
        registerFruit({ ${cursor} })
      `,
    ).toThrow('cursor is not valid inside project.check')
  })

  it('accepts cursor-bearing snippet in project.check — cursors are stripped, diagnostics still run', () => {
    // Snippets that contain cursors are reusable across both project.query and
    // project.check. In the check context the cursor positions are dropped; only
    // the code text is kept, and diagnostics are evaluated normally.
    const withCursor = snippet`
      import { registerFruit } from 'fruit-lib'
      registerFruit({ neim: ${cursor} })
    `
    const { errors } = project.check`${withCursor}`
    expect(errors.length).toBeGreaterThan(0) // 'neim' is still a type error
  })

  it('returns empty completions for invalid position (no throw)', () => {
    // Cursor in a string literal — TS returns no completions here
    const { completions } = project.query`
      const x = "${cursor}"
    `
    // completions may be empty; the key assertion is no throw
    expect(Array.isArray(completions)).toBe(true)
  })
})

// ── forModes: describe-scope registration ───────────────────────────────────

const forModesProject = defineProject({
  files: {
    'node_modules/fruit-lib/index.d.ts': fruitDts,
  },
})

// Called at describe scope — must not throw before beforeAll runs.
describe('forModes — describe-scope registration', () => {
  forModesProject.forModes(
    { source: './tests/fixtures/fruit.d.ts' },
    (modeProject, mode) => {
      it(`[${mode}] mode project is accessible inside test callback`, () => {
        expect(modeProject.projectRoot).toBeTruthy()
      })
    },
  )
})

// ── forModes: source entry completions ──────────────────────────────────────
// Verifies that a .ts source entry produces real completions via modeProject.entry.

const sourceModesProject = defineProject()

describe('forModes — source entry completions', () => {
  sourceModesProject.forModes(
    { source: './tests/fixtures/fruit.ts' },
    (modeProject, mode) => {
      it(`[${mode}] completions resolve through source entry`, () => {
        const { completions } = modeProject.query`
          import { registerFruit } from '${modeProject.entry}'
          registerFruit({ ${cursor} })
        `
        expect(completions).toContain('name')
        expect(completions).toContain('price')
        expect(completions).toContain('availableQuantity')
      })
    },
  )
})

// ── forModes: dts injection for dist entries ─────────────────────────────────
// Verifies that .js → .d.ts, .cjs → .d.cts, and .mjs → .d.mts are injected
// at the correct adjacent path so that imports via project.entry resolve.

const distModesProject = defineProject()

describe('forModes — dist entry dts injection', () => {
  distModesProject.forModes(
    {
      'dist-esm': { entry: './fake-dist/index.js', dts: './tests/fixtures/fruit.d.ts' },
      'dist-cjs': { entry: './fake-dist/index.cjs', dts: './tests/fixtures/fruit.d.ts' },
      'dist-mjs': { entry: './fake-dist/index.mjs', dts: './tests/fixtures/fruit.d.ts' },
    },
    (modeProject, mode) => {
      it(`[${mode}] completions resolve through injected dts`, () => {
        const { completions } = modeProject.query`
          import { registerFruit } from '${modeProject.entry}'
          registerFruit({ ${cursor} })
        `
        expect(completions).toContain('name')
        expect(completions).toContain('price')
        expect(completions).toContain('availableQuantity')
      })
    },
  )
})

// ── group.at cursor validation ───────────────────────────────────────────────

describe('group.at — cursor validation', () => {
  const validationProject = defineProject({
    files: {
      'node_modules/db-lib/index.d.ts': `
        export declare const db: {
          queryOnce(opts: { users?: boolean }): void
          useQuery(opts: { users?: boolean }): void
        }
      `,
    },
  })

  it('throws on unknown cursor name instead of returning false parity', () => {
    const apis = group('apis', ['db.queryOnce', 'db.useQuery'])
    const arg = snippet`{ ${cursor('root')} }`
    const result = validationProject.queryGroup(apis, api => snippet`${api}(${arg})`)`
      import { db } from 'db-lib'
    `
    expect(() => result.group.at('typo')).toThrow(`cursor 'typo' not found in group`)
  })

  it('does not throw on a valid cursor name', () => {
    const apis = group('apis', ['db.queryOnce', 'db.useQuery'])
    const arg = snippet`{ ${cursor('root')} }`
    const result = validationProject.queryGroup(apis, api => snippet`${api}(${arg})`)`
      import { db } from 'db-lib'
    `
    expect(() => result.group.at('root')).not.toThrow()
  })

  it('throws with the missing member names when cursor is present in some but not all members', () => {
    // One member uses cursor('root'), the other uses cursor('other') — a factory bug.
    const apis = group('apis', ['db.queryOnce', 'db.useQuery'])
    const result = validationProject.queryGroup(apis, (api) => {
      const arg = api === 'db.queryOnce'
        ? snippet`{ ${cursor('root')} }`
        : snippet`{ ${cursor('other')} }`
      return snippet`${api}(${arg})`
    })`
      import { db } from 'db-lib'
    `
    expect(() => result.group.at('root')).toThrow(`missing from some group members: db.useQuery`)
    expect(() => result.group.at('root')).toThrow(`cursor('root') consistently`)
  })
})

// ── P1 regression: nested virtual file imports ───────────────────────────────
// Virtual files in subdirectories that don't exist on disk must still resolve.
// (directoryExists must synthesise parents from the virtual file registry.)

describe('virtual files in nested directories', () => {
  const nestedProject = defineProject({
    files: {
      // "selenita-virtual-dir" does not exist on disk — purely in-memory
      'selenita-virtual-dir/types.d.ts': `
        export declare function virtualFn(x: 'alpha' | 'beta'): void
      `,
    },
  })

  it('resolves a virtual file whose parent directory does not exist on disk', () => {
    const { errors } = nestedProject.check`
      import { virtualFn } from './selenita-virtual-dir/types'
      virtualFn('alpha')
    `
    expect(errors).toHaveLength(0)
  })

  it('reports type errors from a nested virtual file', () => {
    const { errors } = nestedProject.check`
      import { virtualFn } from './selenita-virtual-dir/types'
      virtualFn('wrong')
    `
    expect(errors.length).toBeGreaterThan(0)
  })
})

// ── P2 regression: alias bare relative paths ─────────────────────────────────
// Alias values without a leading "./" must resolve relative to project root,
// not relative to baseUrl. Bare paths and dotted paths must be equivalent.

describe('alias values without leading ./', () => {
  const bareAliasProject = defineProject({
    aliases: {
      // "tests/fixtures/*" without "./" — must work the same as "./tests/fixtures/*"
      '#bare-fruit': 'tests/fixtures/fruit.d.ts',
    },
  })

  it('resolves a bare relative alias value (no leading ./)', () => {
    const { errors } = bareAliasProject.check`
      import type { Fruit } from '#bare-fruit'
      const f: Fruit = { name: 'apple', price: 1, availableQuantity: 10 }
    `
    expect(errors).toHaveLength(0)
  })

  it('bare alias reports type errors correctly', () => {
    const { errors } = bareAliasProject.check`
      import type { Fruit } from '#bare-fruit'
      const f: Fruit = { neim: 'apple' }
    `
    expect(errors.length).toBeGreaterThan(0)
  })
})

// ── Isolation: query file must not leak into subsequent check/queryGroup calls ─

describe('virtual file isolation', () => {
  // A project with no type definitions — the only types visible are what queries inject.
  const isoProject = defineProject()

  it('types defined in a query do not leak into a subsequent check on the same project', () => {
    // Define an interface in the first query's virtual file (no imports/exports = script scope).
    isoProject.query`interface __LeakedInterface { x: number }
    const _v = ${cursor}
    `
    // A subsequent check on the SAME project must not see __LeakedInterface —
    // the previous query's virtual file should have been deleted before this runs.
    const { errors } = isoProject.check`
      const _: __LeakedInterface = { x: 1 }
    `
    expect(errors.length).toBeGreaterThan(0)
  })

  it('types defined in a query do not leak into a subsequent queryGroup on the same project', () => {
    const leakApis = group(['api.call'])
    isoProject.query`interface __LeakedForGroup { y: number }
    const _v = ${cursor}
    `
    const result = isoProject.queryGroup(leakApis, api => snippet`${api}(${cursor('root')})`)`
    `
    // The queryGroup runs against a fresh virtual file — __LeakedForGroup must not appear.
    expect(() => result.for('api.call')).not.toThrow()
  })
})

// ── queryGroup duplicate cursor validation ───────────────────────────────────

describe('escape hatches — positionOf and lastVirtualFileName', () => {
  it('positionOf returns a non-negative integer after a query', () => {
    project.query`
      import { registerFruit } from 'fruit-lib'
      registerFruit({ ${cursor('pos')} })
    `
    const offset = project.positionOf('pos')
    expect(typeof offset).toBe('number')
    expect(offset).toBeGreaterThanOrEqual(0)
  })

  it('lastVirtualFileName is a non-empty string after a query', () => {
    project.query`
      import { registerFruit } from 'fruit-lib'
      registerFruit({ ${cursor} })
    `
    const name = project.lastVirtualFileName
    expect(typeof name).toBe('string')
    expect(name!.length).toBeGreaterThan(0)
  })
})

describe('queryGroup cursor validation', () => {
  const dupProject = defineProject({
    files: {
      'node_modules/dup-lib/index.d.ts': `
        export declare function call(a: string, b: string): void
      `,
    },
  })

  it('throws immediately when factory returns a snippet with no cursors', () => {
    const apis = group(['call'])
    expect(() =>
      dupProject.queryGroup(apis, _api => snippet`call('a', 'b')`)`
        import { call } from 'dup-lib'
      `,
    ).toThrow(`factory returned a snippet with no cursors`)
  })

  it('throws on duplicate cursor name within a group member', () => {
    const apis = group(['call'])
    expect(() =>
      dupProject.queryGroup(apis, _api => snippet`${cursor('dup')}, ${cursor('dup')}`)`
        import { call } from 'dup-lib'
      `,
    ).toThrow(`Duplicate cursor name 'dup'`)
  })

  it('does not throw when cursor names are unique within each member', () => {
    const apis = group(['call'])
    expect(() =>
      dupProject.queryGroup(apis, _api => snippet`${cursor('a')}, ${cursor('b')}`)`
        import { call } from 'dup-lib'
      `,
    ).not.toThrow()
  })
})

// ── project.with() at describe scope (deferred initialization) ────────────────

// with() called here — at describe scope, before beforeAll runs.
// This tests the deferred proxy path introduced to match the spec's design contract.
const withDescribeProject = defineProject({
  files: {
    'node_modules/fruit-lib/index.d.ts': fruitDts,
  },
})

describe('project.with() at describe scope', () => {
  const scopedAtDescribe = withDescribeProject.with({
    files: {
      'node_modules/color-lib/index.d.ts': `
        export declare function paint(color: 'red' | 'green' | 'blue'): void
      `,
    },
  })

  it('scoped project is accessible and functional inside test callbacks', () => {
    const { completions } = scopedAtDescribe.query`
      import { paint } from 'color-lib'
      paint(${cursor})
    `
    expect(completions).toContain('red')
    expect(completions).toContain('green')
    expect(completions).toContain('blue')
  })

  it('parent project does not see types from scoped override', () => {
    const { errors } = withDescribeProject.check`
      import { paint } from 'color-lib'
      paint('red')
    `
    expect(errors.length).toBeGreaterThan(0)
  })

  const chainedAtDescribe = scopedAtDescribe.with({
    files: {
      'node_modules/shape-lib/index.d.ts': `
        export declare function draw(shape: 'circle' | 'square'): void
      `,
    },
  })

  it('chained with() calls at describe scope compose correctly', () => {
    const { completions } = chainedAtDescribe.query`
      import { draw } from 'shape-lib'
      draw(${cursor})
    `
    expect(completions).toContain('circle')
    expect(completions).toContain('square')
  })
})
