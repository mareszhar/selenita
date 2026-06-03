// Validates that the main package exports are correctly typed in a consumer install.
// Run with: tsc --noEmit -p tests/consumer/tsconfig.json (requires a fresh build first)
import type { defineProject } from '@mszr/selenita'
import { cursor, group, snippet } from '@mszr/selenita'

declare const _project: ReturnType<typeof defineProject>

// Core API surface
const _query = _project.query`const x = ${cursor}`
const _check = _project.check`const x = 1`
const _with = _project.with({})
const _ls = _project.languageService
const _vp = _project.virtualPath('file.ts')
const _pos = _project.positionOf('cursor')
const _name = _project.lastVirtualFileName

// Primitives
const _cursor = cursor
const _namedCursor = cursor('root')
const _snippet = snippet`hello ${cursor}`
const _group = group('apis', ['a', 'b'])

// forModes
_project.forModes(
  { source: './src/index.ts', dist: { entry: './dist/index.js', dts: './dist/index.d.ts' } },
  (modeProject, _mode) => {
    const _e: string = modeProject.entry
  },
)

// queryGroup
const _qg = _project.queryGroup(_group, api => snippet`${api}()`)
const _qgResult = _qg`import {} from './src'`

// Result shapes
const _completions: string[] = _query.completions
const _errors = _query.errors
const _hover: string | null = _query.hover
const _sh = _query.signatureHelp
const _ci = _query.completionItem('foo')
const _at = _query.at

// check result
const _checkDiags = _check.diagnostics

export {}
