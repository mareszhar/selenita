import type { Buffer } from 'node:buffer'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

// Running a release opts into publishing and, only after success, finishing it in Git.
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
let version: string | undefined
let remainingGitCommands: string[][] = []
try {
  if (!releaseTypes.includes(releaseType as typeof releaseTypes[number]))
    throw new Error(`expected release type: ${releaseTypes.join(', ')}`)
  if (runCommand('git', ['status', '--porcelain']))
    throw new Error('release requires a clean tree; review and commit changes first')
  // Catch missing branch/upstream configuration before publishing an irreversible version.
  runCommand('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'])
  runCommand('git', ['rev-parse', '--abbrev-ref', '@{upstream}'])
  console.log(`Publishing as ${runCommand('npm', ['whoami'])}`)
  snapshot = createVersionSnapshot()
  runCommand('npm', ['version', releaseType!, '--no-git-tag-version', '--ignore-scripts'])
  runCommand('bun', ['install', '--lockfile-only', '--ignore-scripts'])
  version = (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string }).version
  if (runCommand('git', ['tag', '--list', `v${version}`]))
    throw new Error(`release tag v${version} already exists; resolve it before publishing`)
  remainingGitCommands = [
    ['add', '--', ...versionFiles.filter(file => existsSync(resolve(root, file)))],
    ['commit', '-m', `🔖 release v${version}`],
    ['tag', '-a', `v${version}`, '-m', `selenita v${version}`],
    ['push', '--atomic', '--follow-tags'],
  ]
  // Verify after the bump: the build embeds the package version, and this gate builds what gets published.
  console.log(runCommand('bun', ['run', 'verify']))
  // verify already ran; disable lifecycle scripts to avoid a second recursive gate.
  // npm only handles browser/2FA challenges when both stdin and stdout are terminals.
  execFileSync('npm', ['publish', '--access', 'public', '--ignore-scripts'], { cwd: root, stdio: 'inherit' })
  hasPublished = true
  console.log(`Published v${version}. Finishing release in Git…`)
  while (remainingGitCommands.length) {
    execFileSync('git', remainingGitCommands[0]!, { cwd: root, stdio: 'inherit' })
    remainingGitCommands.shift()
  }
  console.log(`Released v${version}: published, committed, tagged, and pushed.`)
}
catch (error) {
  if (snapshot && !hasPublished)
    restoreVersionFiles(snapshot)
  console.error(error instanceof Error ? error.message : String(error))
  if (hasPublished) {
    const commands = remainingGitCommands.map(args => `git ${args.map(arg => `'${arg.replaceAll('\'', '\'\\\'\'')}'`).join(' ')}`).join('\n')
    console.error(`v${version} is already published on npm; version files and completed Git steps were kept. Do not rerun the release script. Resolve the Git failure, then finish with:\n${commands}`)
  }
  process.exitCode = 1
}
