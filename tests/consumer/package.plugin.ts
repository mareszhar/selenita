// Installed and executed by bun run test:package; the gate writes its real CSS file.
// The real CSS file is owned by this fixture: the registry plugin reads it from disk.
import { createRequire } from 'node:module'
import { cursor, defineProject, mark, snippet } from '@mszr/selenita/vitest'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const plugin = require('typescript-plugin-css-modules')

const plain = defineProject()
const project = defineProject({ plugins: [plugin] })

it('offers real generated CSS module keys with a plugin-off control', () => {
  const fixture = snippet`import styles from './button.module.css'; styles.${cursor}`
  expect(project.query`${fixture}`).toSuggestOnly(['button', 'card'])
  expect(plain.query`${fixture}`).not.toSuggest(['button', 'card'])
  expect(plain.check`import styles from './button.module.css'; void styles`).toHaveError(2307)
})

it('reports a misspelled generated key and rechecks its code fix', () => {
  const result = project.query`import styles from './button.module.css'; void styles.${mark('typo')`buton`}`
  expect(result).toHaveError(2551, /button/, { on: result.rangeOf('typo') })
  const diagnostic = result.errors.find(error => error.code === 2551)!
  const fix = diagnostic.codeFixes.find(action => action.edits.some(edit => edit.newText === 'button'))
  expect(fix).toBeDefined()
  expect(fix!.edits).toContainEqual({ range: result.rangeOf('typo'), newText: 'button' })
  expect(project.check(fix!.fixedFiles)).toBeClean()
})

it('preserves cross-file rename through the production plugin and excludes unrelated keys', () => {
  const result = project.query({
    'colors.ts': snippet`export const colors = { ${mark('definition')`brand`}: '#635bff' }`,
    'consumer.ts': snippet`import { colors } from './colors'; void colors.${mark('use')`brand`}`,
    'unrelated.ts': 'export const unrelated = { brand: 0 }',
  })
  const expected = [result.rangeOf('definition'), result.rangeOf('use')]
  expect(result.at('definition').rename.locations).toEqual(expected)
  expect(result.at('use').rename.locations).toEqual(expected)
})
