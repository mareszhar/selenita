import type { Interpolation, Project } from '../src/types'
import { cursor, mark, snippet } from '../src/markers'

// Typechecked only: exercising inference must not invoke an unbuilt service.
function checkMarkerNames(project: Project) {
  // ── Cases ────────────────────────────────────────────────────────────────────

  const values: Interpolation[] = []
  project.query`${values}`.at('dynamicName')

  const prelude = `import { api } from './src'`

  // 1. Named cursors autocomplete and typos fail.
  const pairResult = project.query`
    ${prelude}
    api.${cursor('root')}
    api.options.${cursor('options')}
  `
  pairResult.at('root')
  pairResult.at('options')
  // @ts-expect-error — typo is a compile error
  pairResult.at('optoins')

  // 2. Marks are tracked separately; a mark is also observable at its start.
  const markedResult = project.query`
    style({ ${mark('typo')`paddin`}: 8, ${cursor('next')} })
  `
  markedResult.rangeOf('typo')
  markedResult.at('typo')
  markedResult.at('next')
  markedResult.rangeOf('next') // a cursor's range is empty
  // @ts-expect-error — unknown marker
  markedResult.rangeOf('nope')

  // 3. Snippets carry names; `.scope()` scopes them.
  const filter = snippet`{ status: 'open', ${cursor('filter')} }`
  const scopedResult = project.query`
    db.findMany(${filter.scope('list')})
    db.findOne(${filter.scope('single')})
  `
  scopedResult.at('list.filter')
  scopedResult.at('single.filter')
  // @ts-expect-error — the unscoped name does not exist
  scopedResult.at('filter')

  // 4. Arrays fan out; `atEach` takes the last segment.
  const dbs = ['officialDb', 'baselineDb'] as const
  const fanOutResult = project.query`
    ${prelude}
    ${dbs.map(db => snippet`${db}.useQuery({ ${cursor('root')} })`.scope(db))}
  `
  fanOutResult.at('officialDb.root')
  fanOutResult.atEach('root')
  // @ts-expect-error — no cursor ends with `.where`
  fanOutResult.atEach('where')

  // 5. Dynamic names degrade gracefully to `string`.
  const names: string[] = []
  const dynamicResult = project.query`${names.map(name => snippet`${name}(${cursor(name)})`)}`
  dynamicResult.at('anything')

  // Joined snippets retain literal cursor, mark and scope names through nested arrays.
  const joined = snippet.join(dbs.map(db => snippet`${mark('call')`${db}.useQuery({ ${cursor('root')} })`}`.scope(db)), '\n')
  const joinedResult = project.query`${joined.scope('ctx')}`
  joinedResult.at('ctx.officialDb.root')
  joinedResult.rangeOf('ctx.baselineDb.call')
  joinedResult.atEach('call', ['ctx.officialDb', 'ctx.baselineDb'])
  // @ts-expect-error unknown joined marker
  joinedResult.at('ctx.officialDb.missing')
  // @ts-expect-error joined scope names remain precise
  joinedResult.atEach('root', ['ctx.missing'])
  const nestedJoin = project.query`${snippet.join([[cursor('caret'), mark('word')`fruit`], ''], ', ')}`
  nestedJoin.at('caret')
  nestedJoin.rangeOf('word')
  // @ts-expect-error not contributed by the nested member
  nestedJoin.at('missing')
  project.query`${snippet.join(values, '\n')}`.at('dynamicName')
  // @ts-expect-error join requires an array
  snippet.join('source', '\n')
  // @ts-expect-error join requires an explicit separator
  snippet.join([])
  // @ts-expect-error separators are text
  snippet.join([], cursor)
  // @ts-expect-error invalid member type
  snippet.join([42], '\n')
  // @ts-expect-error the join method is immutable
  snippet.join = () => joined

  // 6. A mark wrapping a cursor exposes both.
  const nestedResult = project.query`
    void colors.${mark('token')`${cursor('use')}brand`}
  `
  nestedResult.at('use')
  nestedResult.rangeOf('token')

  // 7. Records: names come from every file's snippet.
  const files = project.query({
    'colors.ts': snippet`export const colors = { ${mark('definition')`brand`}: 1 }`,
    'consumer.ts': snippet`void colors.${mark('use')`brand`}; colors.${cursor('member')}`,
    'plain.ts': '',
  })
  files.rangeOf('definition')
  files.at('member')
  // @ts-expect-error — not a marker in any file
  files.at('brandd')

  // 8. A mark inside a mark.
  const outerResult = project.query`call(${mark('call')`fn(${mark('arg')`1`})`}, ${cursor})`
  outerResult.rangeOf('call')
  outerResult.rangeOf('arg')

  // 9. `atEach` takes only scoped names; explicit scopes autocomplete and are checked.
  const mixedResult = project.query`
    ${cursor('root')}
    ${dbs.map(db => snippet`\n${db}.useQuery({ ${cursor('where')} })`.scope(db))}
  `
  mixedResult.atEach('where', ['officialDb', 'baselineDb'])
  // @ts-expect-error — `root` is unscoped, so it cannot be gathered across scopes
  mixedResult.atEach('root')
  // @ts-expect-error — not a scope of `where`
  mixedResult.atEach('where', ['officialDb', 'nope'])

  // 10. Scoped marks use the same fan-out and infer their scopes.
  const markedResultByScope = project.query`${snippet`${mark('symbol')`fruit`}`.scope('definition')}; ${snippet`${mark('symbol')`fruit`}`.scope('use')}`
  markedResultByScope.atEach('symbol', ['definition', 'use'])
  // @ts-expect-error — scope names remain precise for marks
  markedResultByScope.atEach('symbol', ['missing'])
  // @ts-expect-error — unknown marked name
  markedResultByScope.atEach('typo')
}
void checkMarkerNames
