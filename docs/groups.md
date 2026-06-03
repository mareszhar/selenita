# Groups & Parity

Groups test that a set of equivalent API calls offer identical completions at equivalent cursor positions.

## Defining a group

```ts
import { group } from '@mszr/selenita'

// Anonymous
const queryApis = group(['db.findMany', 'db.findOne', 'db.aggregate'])

// Named — the label appears in failure output, nothing more
const queryApis = group('queryApis', ['db.findMany', 'db.findOne', 'db.aggregate'])
```

## Running a group query

`project.queryGroup(group, factory)` is a curried tagged template. The factory receives each API name and returns a snippet for that API's call:

```ts
import { cursor, snippet } from '@mszr/selenita'

const filterArg = snippet`{ ${cursor('filter')} }`

const result = project.queryGroup(queryApis, api => snippet`${api}(${filterArg})`)`
  import { db } from './src'
`
```

selenita assembles one virtual file with a call for each group member. Cursor names are automatically scoped per API (`apiName.cursorName`), but you never see those internal names — you address through the result API below.

## Accessing results

```ts
// One specific member's completions
result.for('db.findMany').at('filter').completions

// Cross-API analysis
const analysis = result.group.at('filter')
analysis.completions // Record<string, string[]> — indexed by API name
analysis.hasParity // true if all members have identical completions
analysis.divergence // null when hasParity; DivergenceReport otherwise
```

## Asserting parity

```ts
// With the selenita/vitest matcher
expect(result.group.at('filter')).toHaveCompletionParity()

// Manually
if (!result.group.at('filter').hasParity) {
  console.log(result.group.at('filter').divergence)
  // {
  //   baseline: ['status', 'createdAt'],          // the majority set
  //   members: {
  //     'db.aggregate': { added: ['groupBy'], removed: ['status'] }
  //   }
  // }
}
```

The `baseline` is the completion set shared by the most group members. If there's a tie, the set of the first-listed member wins. `added`/`removed` are relative to the baseline.

## Cross-position parity (two cursors, no group)

For the simpler case of asserting two cursor positions agree, use `toEqualCompletions`:

```ts
const result = project.query`
  import { db } from './src'
  db.findMany(${filterArg.for('list')})
  db.findOne(${filterArg.for('single')})
`
expect(result.at('list.filter').completions)
  .toEqualCompletions(result.at('single.filter').completions)
```
