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
const VALID_BUMPS = new Set(['patch', 'minor', 'major'])
const PRESERVED_FILES = ['package.json', 'package-lock.json', 'npm-shrinkwrap.json']

const releaseType = process.argv[2]

if (!VALID_BUMPS.has(releaseType)) {
  console.error(`Expected one of: ${[...VALID_BUMPS].join(', ')}`)
  process.exit(1)
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url))
const rootDir = path.resolve(scriptDir, '..')
const packageJsonPath = path.join(rootDir, 'package.json')

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    ...options,
  })
}

function runText(command, args) {
  return execFileSync(command, args, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}

function readVersion() {
  return JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version
}

/**
 * Release automation is safest when it starts from a fully clean worktree.
 * That avoids accidentally bundling unrelated changes into the release commit.
 */
function ensureCleanGit() {
  run('git', ['diff', '--quiet', '--ignore-submodules', 'HEAD', '--'])
  run('git', ['diff', '--cached', '--quiet', '--ignore-submodules', '--'])
}

/**
 * These are the version-related files that may change during `npm version`.
 * We snapshot them so a failed publish can restore the repo to its prior state.
 */
function snapshotFiles() {
  const snapshot = new Map()

  for (const relativePath of PRESERVED_FILES) {
    const absolutePath = path.join(rootDir, relativePath)
    if (fs.existsSync(absolutePath))
      snapshot.set(relativePath, fs.readFileSync(absolutePath))
  }

  return snapshot
}

function restoreFiles(snapshot) {
  for (const relativePath of PRESERVED_FILES) {
    const absolutePath = path.join(rootDir, relativePath)
    const original = snapshot.get(relativePath)

    if (original) {
      fs.writeFileSync(absolutePath, original)
      continue
    }

    if (fs.existsSync(absolutePath))
      fs.rmSync(absolutePath)
  }
}

function stagePublishFiles() {
  const existingFiles = PRESERVED_FILES.filter(relativePath => fs.existsSync(path.join(rootDir, relativePath)))
  run('git', ['add', ...existingFiles])
}

let snapshot
let newVersion = null

try {
  ensureCleanGit()

  try {
    const npmUser = runText('npm', ['whoami'])
    console.log(`Publishing as ${npmUser}`)
  }
  catch {
    console.error('npm auth check failed. Run `npm login` first so a failed release does not consume a version.')
    process.exit(1)
  }

  console.log('Running release checks before bumping the version...')
  run('bun', ['run', 'prepublishOnly'])

  snapshot = snapshotFiles()

  console.log(`Bumping ${releaseType} version locally...`)
  run('npm', ['version', releaseType, '--no-git-tag-version'])
  newVersion = readVersion()

  console.log(`Publishing v${newVersion} to npm...`)
  run('npm', ['publish', '--access', 'public'])

  console.log('Recording release commit and tag...')
  stagePublishFiles()
  run('git', ['commit', '-m', `🔖 release v${newVersion}`])
  run('git', ['tag', `v${newVersion}`])

  console.log(`Release complete: v${newVersion}`)
}
catch (error) {
  if (snapshot && newVersion)
    restoreFiles(snapshot)

  if (error && typeof error.status === 'number')
    process.exit(error.status)

  throw error
}
