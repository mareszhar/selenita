import type { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Publishing is opt-in. Git writes remain the maintainer's responsibility.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const releaseTypes = ['patch', 'minor', 'major'] as const
const versionFiles = ['package.json', 'bun.lock', 'package-lock.json', 'npm-shrinkwrap.json']
const releaseType = process.argv[2]
function runCommand(command: string, args: string[]): string {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim()
}
function createVersionSnapshot(): Map<string, Buffer | undefined> {
  return new Map(versionFiles.map(file => [file, existsSync(resolve(root, file)) ? readFileSync(resolve(root, file)) : undefined]))
}
function restoreVersionFiles(snapshot: Map<string, Buffer | undefined>): void {
  for (const [file, contents] of snapshot) {
    if (contents === undefined)
      rmSync(resolve(root, file), { force: true })
    else
      writeFileSync(resolve(root, file), contents)
  }
}
let snapshot: Map<string, Buffer | undefined> | undefined
let hasPublished = false
try {
  if (!releaseTypes.includes(releaseType as typeof releaseTypes[number]))
    throw new Error(`expected release type: ${releaseTypes.join(', ')}`)
  if (runCommand('git', ['status', '--porcelain']))
    throw new Error('release requires a clean tree; review and commit changes first')
  console.log(`Publishing as ${runCommand('npm', ['whoami'])}`)
  snapshot = createVersionSnapshot()
  runCommand('npm', ['version', releaseType!, '--no-git-tag-version', '--ignore-scripts'])
  runCommand('bun', ['install', '--lockfile-only', '--ignore-scripts'])
  const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }
  // Verify after the bump: the build embeds the package version, and this gate builds what gets published.
  console.log(runCommand('bun', ['run', 'verify']))
  // verify already ran; disable lifecycle scripts to avoid a second recursive gate.
  // npm only handles browser/2FA challenges when both stdin and stdout are terminals.
  execFileSync('npm', ['publish', '--access', 'public', '--ignore-scripts'], { cwd: root, stdio: 'inherit' })
  hasPublished = true
  console.log(`Published v${version}. Finish after reviewing the version files:\ngit add ${versionFiles.filter(file => existsSync(resolve(root, file))).join(' ')}\ngit commit -m '🔖 release v${version}'\ngit tag -a v${version} -m 'selenita v${version}'\ngit push --follow-tags`)
}
catch (error) {
  if (snapshot && !hasPublished)
    restoreVersionFiles(snapshot)
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
}
