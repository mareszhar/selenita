import { expect, it } from 'vitest'
import { cursor, defineProject, mark } from '../src/vitest'

const project = defineProject({ tsconfig: false, aliases: { '@mszr/selenita/vitest': './src/vitest.ts' } })
// This is source text for the editor fixture, including its template interpolation.
// eslint-disable-next-line no-template-curly-in-string
const declaration = 'import { cursor, defineProject, mark, snippet } from \'@mszr/selenita/vitest\';\nconst project = defineProject({ tsconfig: false });\nconst result = project.query`const fruit = { apple: 1 }; ${cursor(\'root\')}; ${mark(\'declaration\')`fruit`}; ${snippet`fruit.${cursor(\'member\')}`.scope(\'first\')}; ${snippet`fruit.${cursor(\'member\')}`.scope(\'second\')}`;\n'

it('suggests exactly the inferred markers and scoped fan-out names', () => {
  const result = project.query`${declaration}result.at('${cursor('lookup')}')`
  expect(result.at('lookup')).toSuggestOnly(['root', 'declaration', 'first.member', 'second.member'])
  const fanout = project.query`${declaration}result.atEach('${cursor('member')}')`
  expect(fanout.at('member')).toSuggestOnly(['member'])
  const scopes = project.query`${declaration}result.atEach('member', ['${cursor('scope')}'])`
  expect(scopes.at('scope')).toSuggestOnly(['first', 'second'])
  // eslint-disable-next-line no-template-curly-in-string
  const markedDeclaration = 'const marked = project.query`${snippet`${mark(\'symbol\')`fruit`}`.scope(\'definition\')}; ${snippet`${mark(\'symbol\')`fruit`}`.scope(\'use\')}`;\n'
  const marks = project.query`${declaration}${markedDeclaration}marked.atEach('${cursor('name')}')`
  expect(marks.at('name')).toSuggestOnly(['symbol'])
  const markScopes = project.query`${declaration}${markedDeclaration}marked.atEach('symbol', ['${cursor('scope')}'])`
  expect(markScopes.at('scope')).toSuggestOnly(['definition', 'use'])
})
it('documents every project option and all six editor promise matchers', () => {
  const config = project.query`import { defineProject } from '@mszr/selenita/vitest'; defineProject({ ${cursor('config')} })`
  expect(config.at('config')).toSuggestOnly(['tsconfig', 'compilerOptions', 'preferences', 'files', 'aliases', 'plugins'])
  expect(config.at('config')).toSuggest(['tsconfig', 'compilerOptions', 'preferences', 'files', 'aliases', 'plugins'], { requireDocumentation: true })
  const matcher = project.query`import '@mszr/selenita/vitest'; import { expect } from 'vitest'; expect([]).${cursor('matcher')}`
  const names = ['toSuggest', 'toSuggestOnly', 'toHaveCompletionParity', 'toBeClean', 'toHaveError', 'toHaveErrorCount']
  expect(matcher.at('matcher')).toSuggest(names, { requireDocumentation: true })
  expect(matcher.at('matcher').completionNames.filter(name => names.includes(name))).toSuggestOnly(names)
})
it('underlines a misspelled marker name as a type error', () => {
  const report = project.check`${declaration}result.at(${mark('typo')`'optoins'`})`
  expect(report).toHaveError(2345, /optoins/, { on: report.rangeOf('typo') })
  expect(project.check`${declaration}result.at('root')`).toBeClean()
})

it('documents joining and autocompletes the markers and scopes it preserves', () => {
  const factory = project.query`import { snippet } from '@mszr/selenita/vitest'; snippet.${cursor('join')}`
  expect(factory.at('join')).toSuggest('join', { requireDocumentation: true })
  // eslint-disable-next-line no-template-curly-in-string
  const joinedDeclaration = 'const joined = snippet.join(([\'first\', \'second\'] as const).map(scope => snippet`${mark(\'word\')`${cursor(\'caret\')}fruit`}`.scope(scope)), \', \').scope(\'ctx\');\nconst joinedResult = project.query`${joined}`;\n'
  const lookup = project.query`${declaration}${joinedDeclaration}joinedResult.at('${cursor('name')}')`
  expect(lookup.at('name')).toSuggestOnly(['ctx.first.caret', 'ctx.first.word', 'ctx.second.caret', 'ctx.second.word'])
  const scopes = project.query`${declaration}${joinedDeclaration}joinedResult.atEach('word', ['${cursor('scope')}'])`
  expect(scopes.at('scope')).toSuggestOnly(['ctx.first', 'ctx.second'])
})
