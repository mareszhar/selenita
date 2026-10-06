import { Buffer } from 'node:buffer'
import process from 'node:process'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

// Exercise the real release entry point with command and file boundaries replaced:
// no test can publish a package or write to the repository's Git history.
const host = vi.hoisted(() => ({
  files: new Map<string, Buffer>(),
  commands: [] as string[][],
  failure: '',
  existingTag: false,
}))

vi.mock('node:fs', () => ({
  existsSync: (path: string) => host.files.has(path),
  readFileSync: (path: string, encoding?: string) => encoding ? host.files.get(path)!.toString() : host.files.get(path),
  writeFileSync: (path: string, contents: Buffer) => host.files.set(path, contents),
  rmSync: (path: string) => host.files.delete(path),
}))

vi.mock('node:child_process', () => ({
  execFileSync: (command: string, args: string[]) => {
    host.commands.push([command, ...args])
    const step = command === 'git' && args[0] === 'tag' && args[1] === '--list' ? 'git tag --list' : `${command} ${args[0]}`
    if (step === host.failure)
      throw new Error(`simulated ${step} failure`)
    if (step === 'npm version') {
      const manifest = [...host.files.keys()].find(path => path.endsWith('/package.json'))!
      host.files.set(manifest, Buffer.from('{"version":"0.4.1"}\n'))
      // npm can create a lockfile that was absent before the release.
      host.files.set(manifest.replace('package.json', 'package-lock.json'), Buffer.from('new npm lock'))
    }
    if (step === 'bun install') {
      const lock = [...host.files.keys()].find(path => path.endsWith('/bun.lock'))!
      host.files.set(lock, Buffer.from('bumped bun lock'))
    }
    if (step === 'git tag --list')
      return host.existingTag ? 'v0.4.1' : ''
    return step === 'npm whoami' ? 'maintainer' : ''
  },
}))

const root = new URL('../', import.meta.url).pathname.replace(/\/$/, '')
const originalArguments = [...process.argv]
const originalExitCode = process.exitCode
let initialFiles: Map<string, Buffer>

beforeEach(() => {
  vi.resetModules()
  host.files = new Map([
    [`${root}/package.json`, Buffer.from('{"version":"0.4.0"}\n')],
    [`${root}/bun.lock`, Buffer.from('original bun lock')],
  ])
  initialFiles = new Map(host.files)
  host.commands = []
  host.failure = ''
  host.existingTag = false
  process.argv = ['bun', 'scripts/release.ts', 'patch']
  process.exitCode = 0
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  process.argv = originalArguments
  process.exitCode = originalExitCode
  vi.restoreAllMocks()
})

function gitWrites(): string[][] {
  return host.commands.filter(([command, action, option]) => command === 'git' && (
    ['add', 'commit', 'push'].includes(action!) || (action === 'tag' && option === '-a')
  ))
}

it('finishes a successfully published version with its release commit, annotated tag, and atomic push', async () => {
  await import('../scripts/release')

  expect(process.exitCode).toBe(0)
  expect(host.files.get(`${root}/package.json`)!.toString()).toContain('0.4.1')
  const writes = gitWrites()
  expect(writes).toEqual([
    ['git', 'add', '--', 'package.json', 'bun.lock', 'package-lock.json'],
    ['git', 'commit', '-m', '🔖 release v0.4.1'],
    ['git', 'tag', '-a', 'v0.4.1', '-m', 'selenita v0.4.1'],
    ['git', 'push', '--atomic', '--follow-tags'],
  ])
  expect(host.commands.indexOf(writes[0]!)).toBeGreaterThan(host.commands.findIndex(([command, action]) => command === 'npm' && action === 'publish'))
})

it.each(['npm version', 'bun install', 'bun run', 'npm publish'])('restores the version files without any Git writes when %s fails', async (failure) => {
  host.failure = failure
  await import('../scripts/release')

  expect(process.exitCode).toBe(1)
  expect(host.commands.some(command => command.slice(0, 2).join(' ') === failure)).toBe(true)
  expect(host.files).toEqual(initialFiles)
  expect(gitWrites()).toEqual([])
})

it('rejects an existing release tag before publishing and restores the version files', async () => {
  host.existingTag = true
  await import('../scripts/release')

  expect(process.exitCode).toBe(1)
  expect(host.commands).toContainEqual(['git', 'tag', '--list', 'v0.4.1'])
  expect(host.commands.some(([command, action]) => command === 'npm' && action === 'publish')).toBe(false)
  expect(host.files).toEqual(initialFiles)
  expect(gitWrites()).toEqual([])
})

it.each(['git symbolic-ref', 'git rev-parse'])('rejects missing branch configuration before bumping or publishing when %s fails', async (failure) => {
  host.failure = failure
  await import('../scripts/release')

  expect(process.exitCode).toBe(1)
  expect(host.commands.some(command => command.slice(0, 2).join(' ') === failure)).toBe(true)
  expect(host.commands.some(([command]) => command === 'npm')).toBe(false)
  expect(host.files).toEqual(initialFiles)
  expect(gitWrites()).toEqual([])
})

it.each(['add', 'commit', 'tag', 'push'])('keeps the published version and prints remaining commands when git %s fails', async (action) => {
  host.failure = `git ${action}`
  await import('../scripts/release')

  expect(process.exitCode).toBe(1)
  expect(host.commands).toContainEqual(['npm', 'publish', '--access', 'public', '--ignore-scripts'])
  expect(host.files.get(`${root}/package.json`)!.toString()).toContain('0.4.1')
  expect(host.files.has(`${root}/package-lock.json`)).toBe(true)
  const actions = ['add', 'commit', 'tag', 'push']
  expect(gitWrites().map(command => command[1])).toEqual(actions.slice(0, actions.indexOf(action) + 1))
  const message = vi.mocked(console.error).mock.calls.at(-1)![0] as string
  expect(message).toContain('already published on npm')
  expect(message).toContain('Do not rerun the release script')
  expect(message.split('\n').slice(1).map(command => command.split('\'')[1])).toEqual(actions.slice(actions.indexOf(action)))
})
