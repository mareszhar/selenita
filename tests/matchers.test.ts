import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cursor, defineProject } from '../src/index'

const fruitDts = readFileSync(resolve(__dirname, 'fixtures/fruit.d.ts'), 'utf-8')

const project = defineProject({
  files: { 'node_modules/fruit-lib/index.d.ts': fruitDts },
})

describe('selenita/vitest matchers', () => {
  describe('completion matchers', () => {
    it('toContainCompletion', () => {
      const { completions } = project.query`
        import { registerFruit } from 'fruit-lib'
        registerFruit({ ${cursor} })
      ` as { completions: string[] }

      expect(completions).toContainCompletion('name')
      expect(completions).not.toContainCompletion('neim')
    })

    it('toContainCompletions', () => {
      const { completions } = project.query`
        import { registerFruit } from 'fruit-lib'
        registerFruit({ ${cursor} })
      ` as { completions: string[] }

      expect(completions).toContainCompletions(['name', 'price', 'availableQuantity'])
    })

    it('toEqualCompletions (order-insensitive)', () => {
      const a = ['price', 'name', 'availableQuantity']
      const b = ['name', 'availableQuantity', 'price']
      expect(a).toEqualCompletions(b)
    })
  })

  describe('completion item matchers', () => {
    it('toHaveKind / toHaveType', () => {
      const result = project.query`
        import { registerFruit } from 'fruit-lib'
        registerFruit({ ${cursor} })
      ` as { completionItem: (n: string) => import('../src/types.ts').CompletionItem | undefined }

      expect(result.completionItem('name')).toHaveKind('property')
      expect(result.completionItem('name')).toHaveType('string')
    })

    it('toBeDeprecated / not.toBeDeprecated', () => {
      const result = project.query`
        import { registerFruit } from 'fruit-lib'
        registerFruit({ ${cursor} })
      ` as { completionItem: (n: string) => import('../src/types.ts').CompletionItem | undefined }

      expect(result.completionItem('name')).not.toBeDeprecated()
    })
  })

  describe('diagnostic matchers', () => {
    it('toBeClean', () => {
      const { errors } = project.check`
        import { registerFruit } from 'fruit-lib'
        registerFruit({ name: 'apple', price: 5, availableQuantity: 100 })
      `
      expect(errors).toBeClean()
    })

    it('toHaveError by code', () => {
      const { errors } = project.check`
        import { registerFruit } from 'fruit-lib'
        registerFruit({ neim: 'apple' })
      `
      // TS error 2353: Object literal may only specify known properties
      // or 2345: Argument of type X is not assignable to parameter of type Y
      expect(errors.length).toBeGreaterThan(0)
      expect(errors).toHaveError(errors[0]!.code)
    })

    it('toHaveErrorCount', () => {
      const { errors } = project.check`
        import { registerFruit } from 'fruit-lib'
        registerFruit({ neim: 'apple' })
      `
      expect(errors).toHaveErrorCount(errors.length)
    })
  })

  describe('signature help matchers', () => {
    it('toBeActiveOnParameter', () => {
      const { signatureHelp } = project.query`
        import { registerFruit } from 'fruit-lib'
        registerFruit(${cursor})
      ` as { signatureHelp: import('../src/types.ts').SignatureHelp | null }

      if (signatureHelp) {
        expect(signatureHelp).toBeActiveOnParameter(0)
      }
    })
  })

  describe('toMatchTypeSnapshot', () => {
    it('passes for hover text from a real query', () => {
      const { hover } = project.query`
        import { registerFruit } from 'fruit-lib'
        registerFruit${cursor}
      `
      expect(hover).toMatchTypeSnapshot()
    })

    it('passes for completionItems from a real query', () => {
      const result = project.query`
        import { registerFruit } from 'fruit-lib'
        registerFruit({ ${cursor} })
      `
      expect(result.completionItems).toMatchTypeSnapshot()
    })

    it('passes when a named key disambiguates multiple calls in the same test', () => {
      const { hover } = project.query`
        import { registerFruit } from 'fruit-lib'
        registerFruit${cursor}
      `
      expect(hover).toMatchTypeSnapshot('hover')
      expect(hover).toMatchTypeSnapshot('hover-again')
    })

    it('rejects when the stored snapshot does not match the received value', () => {
      // Write an initial snapshot for 'mismatch-probe', then immediately pass a
      // different value. The stored entry already holds 'first-value'; passing
      // 'second-value' must cause the matcher to fail (return pass: false), which
      // Vitest surfaces as a thrown AssertionError.
      expect('first-value').toMatchTypeSnapshot('mismatch-probe')
      expect(() => {
        expect('second-value').toMatchTypeSnapshot('mismatch-probe')
      }).toThrowError(/Type snapshot mismatch/)
    })
  })
})
