import * as fs from 'node:fs'
import * as path from 'node:path'
import process from 'node:process'
import * as ts from 'typescript'

// ── Virtual file registry ───────────────────────────────────────────────────

interface VirtualFile {
  content: string
  version: number
}

// ── Language service host ───────────────────────────────────────────────────

/** @internal */
export class SelenitaHost implements ts.LanguageServiceHost {
  private virtualFiles = new Map<string, VirtualFile>()
  private realFileNames: readonly string[]

  constructor(
    private compilerOptions: ts.CompilerOptions,
    private projectRoot: string,
    realFileNames: readonly string[] = [],
  ) {
    this.realFileNames = realFileNames
  }

  // ── Virtual file management ───────────────────────────────────────────────

  setVirtualFile(fileName: string, content: string): void {
    const existing = this.virtualFiles.get(fileName)
    this.virtualFiles.set(fileName, {
      content,
      version: existing ? existing.version + 1 : 1,
    })
  }

  deleteVirtualFile(fileName: string): void {
    this.virtualFiles.delete(fileName)
  }

  hasVirtualFile(fileName: string): boolean {
    return this.virtualFiles.has(fileName)
  }

  /** Merge additional virtual files (for project.with() and defineProject files option). */
  addVirtualFiles(files: Record<string, string>): void {
    for (const [filePath, content] of Object.entries(files)) {
      const absolute = path.isAbsolute(filePath)
        ? filePath
        : path.resolve(this.projectRoot, filePath)
      this.setVirtualFile(absolute, content)
    }
  }

  /** Merge additional path aliases into compiler options. */
  addAliases(aliases: Record<string, string>): void {
    const currentPaths = this.compilerOptions.paths ?? {}
    const newPaths: ts.MapLike<string[]> = { ...currentPaths }

    for (const [key, value] of Object.entries(aliases)) {
      // Resolve to absolute so that the path is independent of any baseUrl the
      // caller's tsconfig may set (TypeScript resolves paths values relative to
      // baseUrl; absolute paths bypass that and always resolve correctly).
      newPaths[key] = [resolveAliasPath(value, this.projectRoot)]
    }

    this.compilerOptions = {
      ...this.compilerOptions,
      paths: newPaths,
    }
  }

  // ── ts.LanguageServiceHost interface ─────────────────────────────────────

  getScriptFileNames(): string[] {
    return [...this.realFileNames, ...this.virtualFiles.keys()]
  }

  /** Returns only virtual file names — used by `project.with()` to copy state without touching real disk files. */
  getVirtualFileNames(): string[] {
    return [...this.virtualFiles.keys()]
  }

  getRealFileNames(): readonly string[] {
    return this.realFileNames
  }

  getScriptVersion(fileName: string): string {
    return String(this.virtualFiles.get(fileName)?.version ?? 0)
  }

  getScriptSnapshot(fileName: string): ts.IScriptSnapshot | undefined {
    const virtual = this.virtualFiles.get(fileName)
    if (virtual)
      return ts.ScriptSnapshot.fromString(virtual.content)

    const content = ts.sys.readFile(fileName)
    if (content !== undefined)
      return ts.ScriptSnapshot.fromString(content)

    return undefined
  }

  getCurrentDirectory(): string {
    return this.projectRoot
  }

  getCompilationSettings(): ts.CompilerOptions {
    return this.compilerOptions
  }

  getDefaultLibFileName(options: ts.CompilerOptions): string {
    return ts.getDefaultLibFilePath(options)
  }

  fileExists(fileName: string): boolean {
    return this.virtualFiles.has(fileName) || ts.sys.fileExists(fileName)
  }

  readFile(fileName: string, encoding?: string): string | undefined {
    const virtual = this.virtualFiles.get(fileName)
    if (virtual)
      return virtual.content
    return ts.sys.readFile(fileName, encoding)
  }

  readDirectory(
    p: string,
    extensions?: readonly string[],
    exclude?: readonly string[],
    include?: readonly string[],
    depth?: number,
  ): string[] {
    return ts.sys.readDirectory(p, extensions, exclude, include, depth)
  }

  directoryExists(directoryName: string): boolean {
    if (ts.sys.directoryExists(directoryName))
      return true
    // A virtual directory "exists" if any virtual file resides within it.
    // Without this, TS module resolution short-circuits before fileExists is reached,
    // causing virtual paths in non-existent real directories to fail silently.
    const normalized = directoryName.replace(/\\/g, '/')
    const prefix = normalized.endsWith('/') ? normalized : `${normalized}/`
    for (const virtualPath of this.virtualFiles.keys()) {
      if (virtualPath.replace(/\\/g, '/').startsWith(prefix))
        return true
    }
    return false
  }

  getDirectories(p: string): string[] {
    return ts.sys.getDirectories(p)
  }

  realpath(p: string): string {
    return ts.sys.realpath?.(p) ?? p
  }

  useCaseSensitiveFileNames(): boolean {
    return ts.sys.useCaseSensitiveFileNames
  }

  // ── Module resolution ─────────────────────────────────────────────────────
  //
  // We override resolveModuleNames so that virtual node_modules packages (those
  // added via `defineProject({ files: { ... } })`) are always found even when
  // they lack a `package.json`. The strategy is: consumer's configured resolution
  // first (preserving fidelity with tsc), then NodeJs as a fallback for virtual
  // packages that Bundler/NodeNext resolution would reject without package.json.

  resolveModuleNames(
    moduleNames: string[],
    containingFile: string,
    _reusedNames: readonly string[] | undefined,
  ): Array<ts.ResolvedModule | undefined> {
    return moduleNames.map(name => this._resolveModuleName(name, containingFile))
  }

  private _resolveModuleName(moduleName: string, containingFile: string): ts.ResolvedModule | undefined {
    // Try the consumer's configured resolution first — preserves fidelity with tsc.
    const result = ts.resolveModuleName(moduleName, containingFile, this.compilerOptions, this)
    if (result.resolvedModule)
      return result.resolvedModule

    // Fall back to NodeJs resolution for virtual packages that lack a package.json
    // (e.g. defineProject({ files: { 'node_modules/x/index.d.ts': ... } })).
    // Guard: only accept the fallback result if it resolves to a virtual file —
    // real disk packages must go through the consumer's configured resolution so
    // that an intentionally-restrictive exports map is not silently bypassed.
    if (this.compilerOptions.moduleResolution !== ts.ModuleResolutionKind.NodeJs) {
      const nodeJsOptions = { ...this.compilerOptions, moduleResolution: ts.ModuleResolutionKind.NodeJs }
      const fallback = ts.resolveModuleName(moduleName, containingFile, nodeJsOptions, this)
      if (fallback.resolvedModule && this.virtualFiles.has(fallback.resolvedModule.resolvedFileName))
        return fallback.resolvedModule
    }

    // Explicit fallback for virtual node_modules with no real disk presence.
    const candidates = [
      path.resolve(this.projectRoot, 'node_modules', moduleName, 'index.d.ts'),
      path.resolve(this.projectRoot, 'node_modules', `${moduleName}.d.ts`),
    ]
    for (const candidate of candidates) {
      if (this.virtualFiles.has(candidate))
        return { resolvedFileName: candidate, isExternalLibraryImport: true }
    }

    return undefined
  }
}

// ── Alias path resolution ────────────────────────────────────────────────────

/**
 * Resolve a user-supplied alias value to an absolute path so it is independent
 * of any `baseUrl` the caller's tsconfig may set.  Both dotted (`./foo`) and
 * bare (`foo`) relative paths are resolved from projectRoot.  Wildcard patterns
 * like `./tests/fixtures/*` are handled by resolving only the non-wildcard prefix.
 */
function resolveAliasPath(value: string, projectRoot: string): string {
  if (path.isAbsolute(value))
    return value
  const starIdx = value.indexOf('*')
  if (starIdx === -1)
    return path.resolve(projectRoot, value)
  const prefix = value.slice(0, starIdx)
  const suffix = value.slice(starIdx)
  const hasTrailingSep = prefix.endsWith('/') || prefix.endsWith(path.sep)
  return path.resolve(projectRoot, prefix) + (hasTrailingSep ? '/' : '') + suffix
}

// ── tsconfig resolution ─────────────────────────────────────────────────────

export interface ResolvedConfig {
  options: ts.CompilerOptions
  projectRoot: string
  /** Files listed in tsconfig `include`/`files` — needed as language-service roots for ambient declarations. */
  fileNames: string[]
}

/** Walk up from `from` to find the nearest tsconfig.json. */
function findTsconfig(from: string): string | undefined {
  let dir = fs.statSync(from).isDirectory() ? from : path.dirname(from)
  while (true) {
    const candidate = path.join(dir, 'tsconfig.json')
    if (fs.existsSync(candidate))
      return candidate
    const parent = path.dirname(dir)
    if (parent === dir)
      return undefined
    dir = parent
  }
}

export function resolveConfig(tsconfigPath?: string, cwd = process.cwd()): ResolvedConfig {
  const resolved = tsconfigPath
    ? path.resolve(cwd, tsconfigPath)
    : findTsconfig(cwd)

  if (!resolved) {
    // No tsconfig found — use strict in-memory defaults
    return {
      options: {
        strict: true,
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        lib: ['lib.es2022.d.ts'],
        skipLibCheck: true,
      },
      projectRoot: cwd,
      fileNames: [],
    }
  }

  const configDir = path.dirname(resolved)
  const readResult = ts.readConfigFile(resolved, ts.sys.readFile)

  if (readResult.error) {
    throw new Error(
      `selenita: failed to read tsconfig at ${resolved}:\n${ts.flattenDiagnosticMessageText(readResult.error.messageText, '\n')}`,
    )
  }

  const parsed = ts.parseJsonConfigFileContent(readResult.config, ts.sys, configDir)

  // TS18003 ("No inputs were found in config file") fires for solution-style
  // tsconfigs (references-only) and compiler-options-only tsconfigs. Both are
  // valid selenita setups because files are injected virtually at runtime.
  const fatalErrors = parsed.errors.filter(e => e.code !== 18003)
  if (fatalErrors.length > 0) {
    const msg = fatalErrors
      .map(e => ts.flattenDiagnosticMessageText(e.messageText, '\n'))
      .join('\n')
    throw new Error(`selenita: invalid tsconfig at ${resolved}:\n${msg}`)
  }

  return { options: parsed.options, projectRoot: configDir, fileNames: parsed.fileNames }
}
