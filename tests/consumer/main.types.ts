import type { Completion, CompletionComparison, Diagnostic, Hover, InlayHint, Observations, Project, QueryResult, Range, Rename, SignatureHelp } from '@mszr/selenita'
import type ts from '@typescript/typescript6'
import * as core from '@mszr/selenita'
import { createProject, cursor, mark, snippet } from '@mszr/selenita'

declare const plugin: ts.server.PluginModuleFactory
const project: Project = createProject({ tsconfig: false, plugins: [plugin, [plugin, { enabled: true }]], compilerOptions: { target: 'ES2022' } })
const fragment = snippet`value.${cursor('member')}`
const result = project.query`const value = { apple: 1 }; ${fragment.scope('first')}; ${fragment.scope('second')}; ${mark('declaration')`value`}`
const observation: Observations = result.at('first.member')
const completion: Completion | undefined = observation.findCompletion({ name: 'apple', source: 'fruit-kit' })
const range: Range = result.rangeOf('declaration')
const errors: readonly Diagnostic[] = result.errors
const members = result.atEach('member', ['first', 'second'])
// @ts-expect-error frozen snippet methods cannot be replaced either
fragment.scope = () => fragment as never
const marked = project.query`${snippet`${mark('symbol')`value`}`.scope('first')}; ${snippet`${mark('symbol')`value`}`.scope('second')}`
marked.atEach('symbol', ['first', 'second'])
const joined = snippet.join([fragment.scope('first'), [snippet`${mark('symbol')`value`}`.scope('second')]], ';\n').scope('joined')
const joinedResult = project.query({ 'joined.ts': joined })
joinedResult.at('joined.first.member')
joinedResult.rangeOf('joined.second.symbol')
joinedResult.atEach('symbol', ['joined.second'])
// @ts-expect-error joined marker names remain literal
joinedResult.at('joined.missing')
// @ts-expect-error joined scope names remain literal
joinedResult.atEach('member', ['joined.missing'])
// @ts-expect-error joining requires an explicit separator
snippet.join([])
// @ts-expect-error native join stringification is not accepted
snippet.join([fragment], 42)
// @ts-expect-error the factory join method is readonly
snippet.join = () => fragment
project.extend({ preferences: { includeCompletionsWithInsertText: true } })
result.inspect(({ service, typescript, resolvePath }) => service.getQuickInfoAtPosition(resolvePath('__selenita__.ts'), typescript.version.length))
// @ts-expect-error marker names remain literal
result.at('third.member')
// @ts-expect-error unscoped marks cannot fan out
result.atEach('declaration')
// @ts-expect-error invalid scope
result.atEach('member', ['third'])
// @ts-expect-error removed core runner factory
core.defineProject()
// @ts-expect-error old machinery is absent
project.with({})
void [completion, range, errors, members]

// Frozen evidence should forbid mutation in the editor, while copies stay editable.
function checkFrozenEvidence(completion: Completion, result: QueryResult, hover: Hover, signature: SignatureHelp, hint: InlayHint, rename: Rename, diagnostic: Diagnostic, comparison: CompletionComparison) {
  const copy = { ...completion, name: 'pear' }
  copy.name = 'kiwi'
  const offset: number = result.rangeOf('member').start.offset
  const text: string = hover.documentation
  // @ts-expect-error completion list data is readonly too
  completion.name = 'pear'
  // @ts-expect-error points are readonly
  result.rangeOf('member').start.offset = 42
  // @ts-expect-error range fields are readonly
  result.rangeOf('member').text = 'pear'
  // @ts-expect-error hover is readonly
  hover.documentation = 'changed'
  // @ts-expect-error nested tags are readonly
  hover.tags[0]!.text = 'changed'
  // @ts-expect-error active signature data is readonly
  signature.activeSignature.label = 'changed'
  // @ts-expect-error nested parameters are readonly
  signature.activeSignature.parameters[0]!.name = 'changed'
  // @ts-expect-error the selected parameter is readonly
  signature.activeParameter!.documentation = 'changed'
  // @ts-expect-error signature help is readonly
  signature.activeParameterIndex = 0
  // @ts-expect-error hints are readonly
  hint.kind = 'type'
  // @ts-expect-error rename is readonly
  rename.canRename = false
  // @ts-expect-error rename location data is readonly
  rename.locations[0]!.prefixText = 'changed'
  // @ts-expect-error diagnostics are readonly
  diagnostic.message = 'changed'
  // @ts-expect-error related information is readonly
  diagnostic.relatedInformation[0]!.message = 'changed'
  // @ts-expect-error fixes are readonly
  diagnostic.codeFixes[0]!.description = 'changed'
  // @ts-expect-error edits are readonly
  diagnostic.codeFixes[0]!.edits[0]!.newText = 'changed'
  // @ts-expect-error fixed file maps are readonly
  diagnostic.codeFixes[0]!.fixedFiles['file.ts'] = 'changed'
  // @ts-expect-error comparisons are readonly
  comparison.hasParity = true
  // @ts-expect-error nested differences are readonly
  comparison.differences.first!.added = []
  // @ts-expect-error observation methods cannot be replaced
  result.findCompletion = () => undefined
  void [offset, text, copy]
}
void checkFrozenEvidence
