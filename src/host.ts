import type { ResolvedConfig } from './config'
import type { Fixture, FixtureFile } from './fixture'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import ts, { createVersion } from './typescript'

/** The project's real sources, lifetime files, and one active fixture overlay. */
export class ProjectHost implements ts.LanguageServiceHost {
  private readonly projectFiles = new Map<string, FixtureFile>()
  private readonly realFiles = new Map<string, { text: string, version: string }>()
  private fixture: Fixture | undefined
  private observation: object | undefined
  private observationVersion = 0
  private hasChangedFixture = false
  private projectVersion = 0
  constructor(readonly config: ResolvedConfig) {
    // TypeScript requests normalized paths even when callers use backslashes.
    for (const [key, text] of Object.entries(config.files))
      this.projectFiles.set(resolve(config.root, key).replace(/\\/gu, '/'), { key, text, version: createVersion() })
  }

  activateFixture(fixture: Fixture): void {
    if (fixture === this.fixture)
      return
    this.fixture = fixture
    this.observation = undefined
    this.hasChangedFixture = true
    this.projectVersion++
  }

  activateObservation(observation: object): boolean {
    if (observation === this.observation)
      return false
    if (this.observation !== undefined) {
      // A new fixture version rebuilds the checker while retaining parsed structure and resolutions.
      this.observationVersion++
      this.projectVersion++
    }
    this.observation = observation
    return true
  }

  markProgramCurrent(): void { this.hasChangedFixture = false }

  private findVirtualFile(file: string): FixtureFile | undefined {
    return this.fixture?.files.get(file) ?? this.projectFiles.get(file)
  }

  private findRealFile(file: string): { text: string, version: string } | undefined {
    const cachedFile = this.realFiles.get(file)
    if (cachedFile)
      return cachedFile
    const text = ts.sys.readFile(file)
    if (text === undefined)
      return undefined
    const source = { text, version: `content:${createHash('sha256').update(text).digest('hex')}` }
    this.realFiles.set(file, source)
    return source
  }

  getProjectVersion(): string { return String(this.projectVersion) }
  // Fixture package.json overlays can invalidate an import without changing its text.
  hasInvalidatedResolutions = (): boolean => this.hasChangedFixture
  getScriptFileNames(): string[] {
    return [...new Set([...this.config.rootFiles, ...this.projectFiles.keys(), ...(this.fixture?.files.keys() ?? [])])]
  }

  getScriptVersion(file: string): string {
    const fixtureFile = this.fixture?.files.get(file)
    if (fixtureFile)
      return `${fixtureFile.version}:${this.observationVersion}`
    return this.findVirtualFile(file)?.version ?? this.findRealFile(file)?.version ?? 'missing'
  }

  getScriptSnapshot(file: string): ts.IScriptSnapshot | undefined {
    const text = this.readFile(file)
    return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
  }

  getCurrentDirectory(): string { return this.config.root }
  getCompilationSettings(): ts.CompilerOptions { return this.config.options }
  getDefaultLibFileName(options: ts.CompilerOptions): string { return ts.getDefaultLibFilePath(options) }
  fileExists(file: string): boolean { return this.findVirtualFile(file) !== undefined || ts.sys.fileExists(file) }
  readFile(file: string): string | undefined { return this.findVirtualFile(file)?.text ?? this.findRealFile(file)?.text }
  directoryExists(directory: string): boolean {
    if (ts.sys.directoryExists(directory))
      return true
    const prefix = `${resolve(directory).replace(/\\/gu, '/')}/`
    return [...this.projectFiles.keys(), ...(this.fixture?.files.keys() ?? [])].some(file => file.replace(/\\/gu, '/').startsWith(prefix))
  }

  getDirectories(directory: string): string[] { return ts.sys.getDirectories(directory) }
  readDirectory(...args: Parameters<typeof ts.sys.readDirectory>): string[] { return ts.sys.readDirectory(...args) }
  realpath(path: string): string { return this.findVirtualFile(path) ? path : ts.sys.realpath?.(path) ?? path }
  useCaseSensitiveFileNames(): boolean { return ts.sys.useCaseSensitiveFileNames }
  resolveModuleNameLiterals: NonNullable<ts.LanguageServiceHost['resolveModuleNameLiterals']> = (literals, file, redirected, options, source) => literals.map(literal => ts.resolveModuleName(literal.text, file, options, this, undefined, redirected, ts.getModeForUsageLocation(source, literal, options)))
}
