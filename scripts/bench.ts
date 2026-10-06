import type { ProjectConfig } from '../src/types'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { cpus, platform, release } from 'node:os'
import { resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { cursor, snippet } from '../src/markers'
import { ProjectRuntime } from '../src/project'
import ts from '../src/typescript'

// Run: bun run bench. Optional BENCH_REFERENCE=<source copy>, BENCH_REPETITIONS=5.
const repetitions = Number(process.env.BENCH_REPETITIONS ?? 5)
if (!Number.isInteger(repetitions) || repetitions < 2)
  throw new Error('BENCH_REPETITIONS must be an integer of at least two')
const syntheticConfig: ProjectConfig = { tsconfig: false, files: { 'bench.ts': 'export const fruit = { apple: 1, pear: 2 }' } }
const realisticConfig: ProjectConfig = { tsconfig: resolve('tsconfig.json') }
function createTimingSamples(runOperation: () => void): { medianMs: number, samplesMs: number[] } {
  const samples = Array.from({ length: repetitions }, () => {
    const start = performance.now()
    runOperation()
    return performance.now() - start
  })
  return { medianMs: [...samples].sort((first, second) => first - second)[Math.floor(samples.length / 2)]!, samplesMs: samples }
}
function createMeasurements(config: ProjectConfig) {
  const cold = createTimingSamples(() => {
    using project = new ProjectRuntime([config], undefined, ts.createDocumentRegistry())
    project.warmUp()
  })
  const pairs = Object.fromEntries(['shared', 'private'].map((mode) => {
    const samples: number[] = []
    const retainedBytes: number[] = []
    for (let index = 0; index < repetitions; index++) {
      const registry = ts.createDocumentRegistry()
      using first = new ProjectRuntime([config], undefined, registry)
      first.warmUp()
      globalThis.gc?.()
      const before = process.memoryUsage().heapUsed
      using second = new ProjectRuntime([config], undefined, mode === 'shared' ? registry : ts.createDocumentRegistry())
      const start = performance.now()
      second.warmUp()
      samples.push(performance.now() - start)
      globalThis.gc?.()
      retainedBytes.push(process.memoryUsage().heapUsed - before)
    }
    return [mode, { secondBuildMs: samples, retainedBytes }]
  }))
  using project = new ProjectRuntime([config])
  project.warmUp()
  const completions = createTimingSamples(() => {
    const result = project.query`const fruit = { apple: 1, pear: 2 }; fruit.${cursor}`
    void result.completions
  })
  const full = createTimingSamples(() => {
    const result = project.query`const fruit = { apple: 1, pear: 2 }; fruit.${cursor}`
    for (const completion of result.completions) {
      void completion.displayText
      void completion.documentation
      void completion.tags
      void completion.codeActions
    }
    void [result.hover, result.signatureHelp, result.rename, result.diagnostics, result.inlayHints]
  })
  const multipleObservations = createTimingSamples(() => {
    const result = project.query`const fruit = { apple: 1, pear: 2 }; fruit.${cursor}apple`
    void result.completions
    void result.hover
    void result.errors
    void result.inlayHints
  })
  const parity = createTimingSamples(() => {
    const result = project.query`
      const fruit = { apple: 1, pear: 2 }
      ${snippet.join(Array.from({ length: 10 }, (_, index) => snippet`void fruit.${cursor('member')}apple`.scope(String(index))), '\n')}
    `
    for (const member of Object.values(result.atEach('member')))
      void member.completionNames
  })
  const reactivation = createTimingSamples(() => {
    const first = project.query`const fruit = { apple: 1 }; fruit.${cursor}`
    const second = project.query`const fruit = { pear: 2 }; fruit.${cursor}`
    void second.completionNames
    void first.hover
  })
  globalThis.gc?.()
  const before = process.memoryUsage().heapUsed
  const retained = Array.from({ length: 1000 }, (_, index) => project.query`const fruit = { apple: ${String(index)} }; fruit.${cursor}`)
  globalThis.gc?.()
  const retainedUnreadBytes = process.memoryUsage().heapUsed - before
  for (const result of retained)
    void result.completionNames
  globalThis.gc?.()
  const retainedReadBytes = process.memoryUsage().heapUsed - before
  return { cold, pairs, completions, full, multipleObservations, parity, reactivation, retainedUnreadBytes, retainedReadBytes, retainedResultCount: retained.length }
}
function createHashMeasurements(root: string) {
  const files = ts.sys.readDirectory(root, ['.ts', '.tsx', '.mts', '.cts'], ['**/node_modules/**', '**/__temp__/**', '**/__references__/**', '**/.git/**', '**/dist/**'])
  const sources = files.map(file => readFileSync(file))
  const hashing = createTimingSamples(() => {
    for (const source of sources)
      createHash('sha256').update(source).digest('hex')
  })
  const readingAndHashing = createTimingSamples(() => {
    for (const file of files)
      createHash('sha256').update(readFileSync(file)).digest('hex')
  })
  return { root, fileCount: files.length, bytes: sources.reduce((total, source) => total + source.length, 0), hashing, readingAndHashing }
}
console.log(JSON.stringify({
  runtime: process.versions,
  typescript: ts.version,
  hardware: { cpu: cpus()[0]?.model, coreCount: cpus().length, platform: platform(), release: release() },
  repetitions,
  hasGarbageCollector: typeof globalThis.gc === 'function',
  synthetic: createMeasurements(syntheticConfig),
  realistic: createMeasurements(realisticConfig),
  hashing: [createHashMeasurements(process.cwd()), ...(process.env.BENCH_REFERENCE ? [createHashMeasurements(resolve(process.env.BENCH_REFERENCE))] : [])],
}, null, 2))
