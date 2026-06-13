import type { ExecFileSyncOptions } from 'node:child_process'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

/**
 * Publishes a new npm release without leaving behind an accidental extra
 * version commit when auth or publish fails.
 *
 * Flow:
 * 1. Confirm the git worktree is clean.
 * 2. Confirm npm auth is available before touching version files.
 * 3. Run the project's publish checks before bumping the version.
 * 4. Bump the package version without creating a git commit or tag yet.
 * 5. Publish to npm.
 * 6. Only after a successful publish, create the release commit and tag.
 */
const releaseTypes = ['patch', 'minor', 'major'] as const
const versionFiles = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json'] as const

type ReleaseType = (typeof releaseTypes)[number]
type VersionFilePath = (typeof versionFiles)[number]
type FileSnapshot = Map<VersionFilePath, Uint8Array>

const requestedReleaseType = process.argv[2]

if (!isReleaseType(requestedReleaseType)) {
  console.error(`Expected one of: ${releaseTypes.join(', ')}`)
  process.exit(1)
}

const currentScriptDir = path.dirname(fileURLToPath(import.meta.url))
const repoRootDir = path.resolve(currentScriptDir, '..')
const packageJsonPath = path.join(repoRootDir, 'package.json')

function isReleaseType(value: string | undefined): value is ReleaseType {
  return releaseTypes.includes(value as ReleaseType)
}

function runCommand(command: string, args: string[], options: ExecFileSyncOptions = {}): void {
  execFileSync(command, args, {
    cwd: repoRootDir,
    stdio: 'inherit',
    ...options,
  })
}

function runCommandForText(command: string, args: string[]): string {
  return execFileSync(command, args, {
    cwd: repoRootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function readCurrentVersion(): string {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as { version: string }
  return packageJson.version
}

/**
 * Release automation is safest when it starts from a fully clean worktree.
 * That avoids accidentally bundling unrelated changes into the release commit.
 */
function ensureCleanGitWorktree(): void {
  runCommand('git', ['diff', '--quiet', '--ignore-submodules', 'HEAD', '--'])
  runCommand('git', ['diff', '--cached', '--quiet', '--ignore-submodules', '--'])
}

/**
 * These are the version-related files that may change during `npm version`.
 * We snapshot them so a failed publish can restore the repo to its prior state.
 */
function snapshotVersionFiles(): FileSnapshot {
  const snapshot: FileSnapshot = new Map()

  for (const relativePath of versionFiles) {
    const absolutePath = path.join(repoRootDir, relativePath)
    if (fs.existsSync(absolutePath))
      snapshot.set(relativePath, fs.readFileSync(absolutePath))
  }

  return snapshot
}

function restoreVersionFiles(snapshot: FileSnapshot): void {
  for (const relativePath of versionFiles) {
    const absolutePath = path.join(repoRootDir, relativePath)
    const originalContents = snapshot.get(relativePath)

    if (originalContents) {
      fs.writeFileSync(absolutePath, originalContents)
      continue
    }

    if (fs.existsSync(absolutePath))
      fs.rmSync(absolutePath)
  }
}

function stageVersionFiles(): void {
  const existingFiles = versionFiles.filter(relativePath => fs.existsSync(path.join(repoRootDir, relativePath)))
  runCommand('git', ['add', ...existingFiles])
}

function exitWithCommandStatus(error: unknown): never {
  if (typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number')
    process.exit(error.status)

  throw error
}

let versionFileSnapshot: FileSnapshot | undefined
let publishedVersion: string | undefined

try {
  ensureCleanGitWorktree()

  try {
    const npmUser = runCommandForText('npm', ['whoami'])
    console.log(`Publishing as ${npmUser}`)
  }
  catch {
    console.error('npm auth check failed. Run `npm login` first so a failed release does not consume a version.')
    process.exit(1)
  }

  console.log('Running release checks before bumping the version...')
  runCommand('bun', ['run', 'prepublishOnly'])

  versionFileSnapshot = snapshotVersionFiles()

  console.log(`Bumping ${requestedReleaseType} version locally...`)
  runCommand('npm', ['version', requestedReleaseType, '--no-git-tag-version'])
  publishedVersion = readCurrentVersion()

  console.log(`Publishing v${publishedVersion} to npm...`)
  runCommand('npm', ['publish', '--access', 'public'])

  console.log('Recording release commit and tag...')
  stageVersionFiles()
  runCommand('git', ['commit', '-m', `🔖 release v${publishedVersion}`])
  runCommand('git', ['tag', `v${publishedVersion}`])

  console.log(`Release complete: v${publishedVersion}`)
}
catch (error) {
  if (versionFileSnapshot && publishedVersion)
    restoreVersionFiles(versionFileSnapshot)

  exitWithCommandStatus(error)
}
