import type { GroupValue } from './group'
import type { QueryMeta } from './query'
import type { SnippetValue } from './snippet'
import type {
  CheckResult,
  GroupQueryResult,
  QueryResult,
} from './types'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as ts from 'typescript'
import { resolveConfig, SelenitaHost } from './host'
import { runCheck, runQuery, runQueryGroup } from './query'

// ── Public configuration ────────────────────────────────────────────────────

export interface DefineProjectConfig {
  /**
   * Path to a `tsconfig.json`. If omitted, selenita walks up from the
   * directory where the test runner is invoked (`process.cwd()`) to find the
   * nearest one; if none exists, a strict in-memory TypeScript context is used.
   */
  tsconfig?: string
  /**
   * Virtual files to inject into the in-memory file system.
   * Keys are file paths relative to the project root. These files never touch
   * disk — they exist only in selenita's language-service session.
   *
   * Useful for simulating installed packages, custom `.d.ts` files, or
   * hypothetical type environments.
   */
  files?: Record<string, string>
  /**
   * TypeScript path aliases, following the same `paths` convention as
   * `tsconfig.json`. Keys are import specifiers (optional `*` wildcard);
   * values are filesystem paths relative to the project root.
   *
   * @example
   * ```ts
   * aliases: {
   *   '#core': '../../core/index',
   *   '#fixtures/*': './tests/fixtures/*',
   * }
   * ```
   */
  aliases?: Record<string, string>
}

// ── Mode matrix types ───────────────────────────────────────────────────────

export interface ModeConfig {
  /** Path to the compiled entry file (e.g. `'./dist/esm/index.js'`). */
  entry: string
  /**
   * Path to the `.d.ts` file to use for type information.
   * Required when the entry is a compiled `.js` file without embedded types.
   */
  dts?: string
}

export type ModesMap = Record<string, string | ModeConfig>

// ── Project handle ──────────────────────────────────────────────────────────

export class Project {
  private host: SelenitaHost
  private ls: ts.LanguageService
  readonly projectRoot: string

  /** Entry path for the current mode — set by `forModes`, empty otherwise. */
  get entry(): string { return this._entry }
  private _entry: string = ''

  private _ready: Promise<void>
  private _resolveReady!: () => void
  private _rejectReady!: (err: unknown) => void

  /** The virtual file name and cursor map from the most recent query. */
  private _lastQuery: QueryMeta | null = null

  /** @internal */
  constructor(host: SelenitaHost, ls: ts.LanguageService, projectRoot: string) {
    this.host = host
    this.ls = ls
    this.projectRoot = projectRoot

    this._ready = new Promise<void>((resolve, reject) => {
      this._resolveReady = resolve
      this._rejectReady = reject
    })
  }

  /** @internal — called by `defineProject`'s `beforeAll` */
  _init(): void {
    this._resolveReady()
  }

  /** @internal — called on initialization failure */
  _initError(err: unknown): void {
    this._rejectReady(err)
  }

  /** @internal — called by defineProject's afterAll before disposing the language service */
  _cleanupLastQuery(): void {
    if (this._lastQuery) {
      this.host.deleteVirtualFile(this._lastQuery.fileName)
      this._lastQuery = null
    }
  }

  /** @internal — called by forModes to stamp the mode-scoped entry path */
  _setEntry(value: string): void {
    this._entry = value
  }

  /**
   * Resolves when the TypeScript program has been fully initialized.
   *
   * Not needed in normal use — queries wait for readiness automatically.
   * Provided as an escape hatch for advanced setup (e.g. pre-warming a shared
   * project in a custom test setup file).
   */
  ready(): Promise<void> {
    return this._ready
  }

  // ── Core query API ────────────────────────────────────────────────────────

  /**
   * Query the TypeScript Language Service at one or more cursor positions
   * inside a virtual TypeScript file.
   *
   * **Single cursor** — access results directly:
   * ```ts
   * const { completions, hover } = project.query`
   *   import { registerFruit } from './src'
   *   registerFruit({ ${cursor} })
   * `
   * ```
   *
   * **Multiple named cursors** — use `.at()`:
   * ```ts
   * const result = project.query`
   *   registerFruit({ ${cursor('empty')} })
   *   registerFruit({ name: 'apple', ${cursor('remaining')} })
   * `
   * result.at('empty').completions
   * result.at('remaining').completions
   * ```
   */
  query(strings: TemplateStringsArray, ...values: unknown[]): QueryResult {
    // Delete the previous query's virtual file now that we're about to replace it.
    // Deferring deletion to here (rather than inside runQuery) keeps the file alive
    // long enough for escape-hatch LS calls between two consecutive queries.
    if (this._lastQuery) {
      this.host.deleteVirtualFile(this._lastQuery.fileName)
      this._lastQuery = null
    }
    return runQuery(
      this.ls,
      this.host,
      this.projectRoot,
      strings,
      values,
      (meta) => { this._lastQuery = meta },
    )
  }

  /**
   * Run TypeScript diagnostics on code without a cursor position.
   *
   * Use this to assert that code does (or does not) produce type errors:
   * ```ts
   * const { errors } = project.check`
   *   import { registerFruit } from './src'
   *   registerFruit({ neim: 'apple' })
   * `
   * expect(errors).toHaveError(2353)
   * ```
   */
  check(strings: TemplateStringsArray, ...values: unknown[]): CheckResult {
    // Clear the previous query's virtual file so it cannot affect the type environment here,
    // matching the isolation guarantee that project.query provides between calls.
    if (this._lastQuery) {
      this.host.deleteVirtualFile(this._lastQuery.fileName)
      this._lastQuery = null
    }
    return runCheck(this.ls, this.host, this.projectRoot, strings, values)
  }

  /**
   * Test a group of equivalent APIs for completion parity.
   *
   * ```ts
   * const result = project.queryGroup(queryApis, api => snippet`${api}(${rootArg})`)`
   *   import { db } from './src'
   * `
   * expect(result.group.at('root')).toHaveCompletionParity()
   * ```
   */
  queryGroup(
    groupValue: GroupValue,
    factory: (api: string) => SnippetValue,
  ): (strings: TemplateStringsArray, ...values: unknown[]) => GroupQueryResult {
    return (strings, ...values) => {
      // Clear the previous query's virtual file so it cannot affect the type environment here,
      // matching the isolation guarantee that project.query provides between calls.
      if (this._lastQuery) {
        this.host.deleteVirtualFile(this._lastQuery.fileName)
        this._lastQuery = null
      }
      return runQueryGroup(this.ls, this.host, this.projectRoot, groupValue, factory, strings, values)
    }
  }

  // ── Scoped clone ──────────────────────────────────────────────────────────

  /**
   * Create an immutable scoped clone of this project with additional or
   * overriding configuration. The parent project is not modified.
   *
   * - `aliases` and `files` from the parent are inherited; new values are
   *   merged on top (conflicts are overridden by the `with()` value).
   *
   * ```ts
   * const scoped = project.with({
   *   files: {
   *     'node_modules/hypothetical-lib/index.d.ts': `
   *       export declare function frobnicate(x: 'a' | 'b' | 'c'): void
   *     `,
   *   },
   * })
   * ```
   */
  with(overrides: DefineProjectConfig): Project {
    return this._withInternal(overrides, undefined)
  }

  /** @internal */
  _withInternal(overrides: DefineProjectConfig, compilerOptionsOverride: Partial<ts.CompilerOptions> | undefined): Project {
    const baseOptions = this.host.getCompilationSettings()
    const childOptions = compilerOptionsOverride ? { ...baseOptions, ...compilerOptionsOverride } : baseOptions
    // Real file names are inherited by reference — they live on disk and need no copying.
    const childHost = new SelenitaHost(childOptions, this.projectRoot, this.host.getRealFileNames())

    // Inherit parent virtual files, excluding transient query scratch files.
    // Query files are ephemeral — they exist only while the language service is
    // processing a query and must not pollute child projects.
    for (const fileName of this.host.getVirtualFileNames()) {
      if (path.basename(fileName).startsWith('__selenita_query_'))
        continue
      const snapshot = this.host.getScriptSnapshot(fileName)
      if (snapshot) {
        childHost.setVirtualFile(fileName, snapshot.getText(0, snapshot.getLength()))
      }
    }

    if (overrides.files)
      childHost.addVirtualFiles(overrides.files)
    if (overrides.aliases)
      childHost.addAliases(overrides.aliases)

    const childLs = ts.createLanguageService(childHost)
    const child = new Project(childHost, childLs, this.projectRoot)
    child._resolveReady()
    return child
  }

  // ── Mode matrix ───────────────────────────────────────────────────────────

  /**
   * Run a set of test definitions once per named build target. Designed for
   * library authors verifying that types survive compilation to CJS, ESM, etc.
   *
   * ```ts
   * project.forModes(
   *   {
   *     source:     './src/index.ts',
   *     'dist-esm': { entry: './dist/esm/index.js', dts: './dist/index.d.ts' },
   *     'dist-cjs': { entry: './dist/cjs/index.js', dts: './dist/index.d.ts' },
   *   },
   *   (project, mode) => {
   *     it(`[${mode}] completions survive compilation`, () => {
   *       const { completions } = project.query`
   *         import { registerFruit } from '${project.entry}'
   *         registerFruit({ ${cursor} })
   *       `
   *       expect(completions).toContain('name')
   *     })
   *   }
   * )
   * ```
   */
  forModes(
    modes: ModesMap,
    callback: (project: Project, mode: string) => void,
  ): void {
    for (const [modeName, modeConfig] of Object.entries(modes)) {
      const { entry, dts } = typeof modeConfig === 'string'
        ? { entry: modeConfig, dts: undefined }
        : modeConfig

      const overrides: DefineProjectConfig = {}

      if (dts) {
        const entryAbs = path.resolve(this.projectRoot, entry)
        const dtsAbs = path.resolve(this.projectRoot, dts)
        const dtsContent = fs.readFileSync(dtsAbs, 'utf-8')
        const adjacentDts = entryAbs
          .replace(/\.cjs$/, '.d.cts')
          .replace(/\.mjs$/, '.d.mts')
          .replace(/\.js$/, '.d.ts')
        overrides.files = { [adjacentDts]: dtsContent }
      }

      // Source-mode entries (.ts/.tsx) require allowImportingTsExtensions so that
      // `import { fn } from '${project.entry}'` works in the virtual query file
      // without the consumer needing to set that flag in their own tsconfig.
      const isSourceEntry = /\.(?:ts|tsx)$/.test(entry)
      const compilerOptionsOverride = isSourceEntry ? { allowImportingTsExtensions: true } : undefined

      const modeProject = this._withInternal(overrides, compilerOptionsOverride)
      modeProject._setEntry(path.resolve(this.projectRoot, entry))
      callback(modeProject, modeName)
    }
  }

  // ── Escape hatch ──────────────────────────────────────────────────────────

  /**
   * The raw TypeScript `LanguageService` instance.
   *
   * Use this when selenita's API doesn't cover your case. To translate cursor
   * names to character offsets, combine with `project.positionOf()` after
   * running a query.
   *
   * @remarks This is intentionally a power-user escape hatch, not a supported
   * first-class API. Features accessed through it are not covered by selenita's
   * stability guarantees.
   */
  get languageService(): ts.LanguageService {
    return this.ls
  }

  /**
   * Resolve a project-relative file path to an absolute path.
   * Useful when constructing raw language service calls.
   */
  virtualPath(fileName: string): string {
    return path.resolve(this.projectRoot, fileName)
  }

  /**
   * Return the character offset of a named cursor from the most recently
   * executed `project.query` call.
   *
   * Intended for use with `project.languageService` when you need to call a
   * raw Language Service method at a cursor position:
   * ```ts
   * const result = project.query`someApi(${cursor('root')})`
   * const file   = project.lastVirtualFileName
   * const pos    = project.positionOf('root')
   * const defs   = project.languageService.getDefinitionAtPosition(file!, pos!)
   * ```
   *
   * Returns `undefined` if no query has been run or the cursor name is unknown.
   */
  positionOf(cursorName: string): number | undefined {
    if (!this._lastQuery)
      return undefined
    return this._lastQuery.cursors.get(cursorName)
  }

  /**
   * The virtual file name used by the most recent `project.query` call.
   * Pair with `project.positionOf()` for raw LanguageService calls.
   * Returns `undefined` if no query has been run yet.
   */
  get lastVirtualFileName(): string | undefined {
    return this._lastQuery?.fileName
  }
}

// ── Lifecycle helpers ────────────────────────────────────────────────────────

/**
 * Registers a cleanup function scoped to the current test when possible.
 *
 * Vitest's `afterAll` is only reliably registered during the collection phase
 * (before tests run). Calling it from inside a test body registers a hook that
 * Vitest silently ignores. `onTestFinished` is Vitest's purpose-built API for
 * registering per-test cleanup from inside a test or lifecycle hook; it is
 * available on globalThis when `globals: true` is set (or via vitest's own
 * import), and is available in Vitest ≥0.34. When not available, falls back
 * to the suite-level `afterAll`.
 */
function registerDisposal(suiteLevelAfterAll: (fn: () => void) => void, fn: () => void): void {
  const onTestFinished = (globalThis as Record<string, unknown>).onTestFinished as
    ((fn: () => void) => void) | undefined
  if (onTestFinished) {
    onTestFinished(fn)
  }
  else {
    suiteLevelAfterAll(fn)
  }
}

// ── Deferred project.with() helper ──────────────────────────────────────────

/**
 * Creates a deferred proxy for a scoped child project built via `project.with()`.
 *
 * Used when `with()` is called at module/describe scope (before `beforeAll` runs).
 * Registers its own `beforeAll`/`afterAll` at the caller's scope, then returns a
 * proxy that defers all access until the child project is initialized.
 */
function makeDeferredWithProxy(
  overrides: DefineProjectConfig,
  getParent: () => Project,
): Project {
  // Capture beforeAll/afterAll at the call site's scope so that the child
  // project's lifecycle is tied to the describe (or module) block where with()
  // appears, not to the outer defineProject call site.
  const scopedBeforeAll = (globalThis as Record<string, unknown>).beforeAll as
    ((fn: () => void | Promise<void>) => void)
  const scopedAfterAll = (globalThis as Record<string, unknown>).afterAll as
    ((fn: () => void | Promise<void>) => void)

  let childProject: Project | undefined

  // Parent's beforeAll always runs before a nested describe's beforeAll, so
  // getParent() is guaranteed to be initialized when this fires.
  scopedBeforeAll(() => {
    childProject = getParent()._withInternal(overrides, undefined)
  })

  scopedAfterAll(() => {
    childProject?._cleanupLastQuery()
    childProject?.languageService.dispose()
  })

  return new Proxy({} as Project, {
    get(_t, p: string | symbol) {
      if (p === 'with') {
        return (childOverrides: DefineProjectConfig) => {
          if (childProject) {
            // with() called at test time — register per-test cleanup
            const grandchild = childProject._withInternal(childOverrides, undefined)
            registerDisposal(scopedAfterAll, () => {
              grandchild._cleanupLastQuery()
              grandchild.languageService.dispose()
            })
            return grandchild
          }
          return makeDeferredWithProxy(childOverrides, () => childProject!)
        }
      }

      if (p === 'forModes') {
        return (modes: ModesMap, callback: (project: Project, mode: string) => void) => {
          for (const [modeName, modeConfig] of Object.entries(modes)) {
            const { entry, dts } = typeof modeConfig === 'string'
              ? { entry: modeConfig, dts: undefined }
              : modeConfig

            let modeProject: Project | undefined

            // childProject is guaranteed to exist when this fires because the
            // scopedBeforeAll that creates childProject was registered first.
            scopedBeforeAll(() => {
              const overrides: DefineProjectConfig = {}
              if (dts) {
                const entryAbs = path.resolve(childProject!.projectRoot, entry)
                const dtsAbs = path.resolve(childProject!.projectRoot, dts)
                const dtsContent = fs.readFileSync(dtsAbs, 'utf-8')
                const adjacentDts = entryAbs
                  .replace(/\.cjs$/, '.d.cts')
                  .replace(/\.mjs$/, '.d.mts')
                  .replace(/\.js$/, '.d.ts')
                overrides.files = { [adjacentDts]: dtsContent }
              }
              const isSourceEntry = /\.(?:ts|tsx)$/.test(entry)
              const compilerOptionsOverride = isSourceEntry ? { allowImportingTsExtensions: true } : undefined
              modeProject = childProject!._withInternal(overrides, compilerOptionsOverride)
              modeProject._setEntry(path.resolve(childProject!.projectRoot, entry))
            })

            scopedAfterAll(() => {
              modeProject?._cleanupLastQuery()
              modeProject?.languageService.dispose()
            })

            const modeProxy = new Proxy({} as Project, {
              get(_t2, mp: string | symbol) {
                if (!modeProject) {
                  throw new Error(
                    `selenita: mode project '${modeName}' is not yet initialized. `
                    + `Mode project properties are only accessible inside test callbacks.`,
                  )
                }
                const v = (modeProject as unknown as Record<string | symbol, unknown>)[mp]
                return typeof v === 'function' ? v.bind(modeProject) : v
              },
            })

            callback(modeProxy as Project, modeName)
          }
        }
      }

      if (!childProject) {
        throw new Error(
          `selenita: scoped project from project.with() is not yet initialized. `
          + `Project properties are only accessible inside test callbacks.`,
        )
      }
      const v = (childProject as unknown as Record<string | symbol, unknown>)[p]
      return typeof v === 'function' ? v.bind(childProject) : v
    },
  })
}

// ── defineProject ───────────────────────────────────────────────────────────

/**
 * Create a project handle for running IntelliSense queries.
 *
 * Call this at **module scope** or at the top of a `describe` block — never
 * inside a `test` callback. selenita automatically registers `beforeAll` /
 * `afterAll` hooks to build and dispose the TypeScript program.
 *
 * ```ts
 * // Zero-config — auto-detects the nearest tsconfig.json
 * const project = defineProject()
 *
 * // With an explicit tsconfig
 * const project = defineProject({ tsconfig: './tsconfig.json' })
 *
 * // With virtual type declarations
 * const project = defineProject({
 *   tsconfig: './tsconfig.json',
 *   files: {
 *     'node_modules/my-lib/index.d.ts': `
 *       export declare function registerFruit(fruit: Fruit): void
 *       export interface Fruit { name: string; price: number }
 *     `,
 *   },
 * })
 * ```
 */
export function defineProject(config: DefineProjectConfig = {}): Project {
  const _beforeAll = (globalThis as Record<string, unknown>).beforeAll as
    | ((fn: () => void | Promise<void>) => void)
    | undefined
  const _afterAll = (globalThis as Record<string, unknown>).afterAll as
    | ((fn: () => void | Promise<void>) => void)
    | undefined

  if (!_beforeAll || !_afterAll) {
    throw new Error(
      `selenita: defineProject() requires a test runner with beforeAll/afterAll globals.\n`
      + `Make sure defineProject() is called at module or describe scope (not inside a test), and that your runner exposes beforeAll/afterAll as globals. `
      + `If using Vitest, set globals: true in your vitest.config.ts.`,
    )
  }

  let realProject: Project

  _beforeAll(() => {
    const { options, projectRoot, fileNames } = resolveConfig(config.tsconfig)
    const host = new SelenitaHost(options, projectRoot, fileNames)

    if (config.files)
      host.addVirtualFiles(config.files)
    if (config.aliases)
      host.addAliases(config.aliases)

    const ls = ts.createLanguageService(host)
    // Force eager Program construction so that cold-start cost is paid here in
    // beforeAll, not inside the first test. Matches the spec guarantee (§5, §15)
    // that "the TS Program is built exactly once per project, during beforeAll".
    ls.getProgram()
    realProject = new Project(host, ls, projectRoot)
    realProject._init()
  })

  _afterAll(() => {
    realProject?._cleanupLastQuery()
    realProject?.languageService.dispose()
  })

  // Return a Proxy that defers to realProject at call time. This lets
  // `const project = defineProject()` work at module scope while actual
  // initialization is deferred to beforeAll.
  //
  // `forModes` is special: it must run at test-definition time (before beforeAll)
  // to allow the callback to register it() blocks synchronously. Its proxy
  // handler defers only the with() construction to beforeAll, then wraps each
  // mode in its own lazy proxy so test callbacks can safely access mode properties.
  return new Proxy({} as Project, {
    get(_target, prop: string | symbol) {
      if (prop === 'forModes') {
        return (modes: ModesMap, callback: (project: Project, mode: string) => void) => {
          for (const [modeName, modeConfig] of Object.entries(modes)) {
            const { entry, dts } = typeof modeConfig === 'string'
              ? { entry: modeConfig, dts: undefined }
              : modeConfig

            let modeProject: Project | undefined

            // Runs after the parent project's beforeAll (registered above), so
            // realProject is guaranteed to be initialized when this fires.
            _beforeAll!(() => {
              const overrides: DefineProjectConfig = {}
              if (dts) {
                const entryAbs = path.resolve(realProject.projectRoot, entry)
                const dtsAbs = path.resolve(realProject.projectRoot, dts)
                const dtsContent = fs.readFileSync(dtsAbs, 'utf-8')
                const adjacentDts = entryAbs
                  .replace(/\.cjs$/, '.d.cts')
                  .replace(/\.mjs$/, '.d.mts')
                  .replace(/\.js$/, '.d.ts')
                overrides.files = { [adjacentDts]: dtsContent }
              }
              const isSourceEntry = /\.(?:ts|tsx)$/.test(entry)
              const compilerOptionsOverride = isSourceEntry ? { allowImportingTsExtensions: true } : undefined
              modeProject = realProject._withInternal(overrides, compilerOptionsOverride)
              modeProject._setEntry(path.resolve(realProject.projectRoot, entry))
            })

            _afterAll!(() => {
              modeProject?._cleanupLastQuery()
              modeProject?.languageService.dispose()
            })

            const modeProxy = new Proxy({} as Project, {
              get(_t, p: string | symbol) {
                if (!modeProject) {
                  throw new Error(
                    `selenita: mode project '${modeName}' is not yet initialized. `
                    + `Mode project properties are only accessible inside test callbacks.`,
                  )
                }
                const v = (modeProject as unknown as Record<string | symbol, unknown>)[p]
                return typeof v === 'function' ? v.bind(modeProject) : v
              },
            })

            callback(modeProxy as Project, modeName)
          }
        }
      }

      // project.with() called at module/describe scope (before beforeAll) returns a
      // deferred proxy whose child project is constructed once realProject is ready.
      // project.with() called inside a test (realProject already set) creates the
      // child directly and registers per-test disposal via onTestFinished.
      if (prop === 'with') {
        if (!realProject) {
          return (overrides: DefineProjectConfig) =>
            makeDeferredWithProxy(overrides, () => realProject)
        }
        return (overrides: DefineProjectConfig) => {
          const child = realProject._withInternal(overrides, undefined)
          registerDisposal(_afterAll!, () => {
            child._cleanupLastQuery()
            child.languageService.dispose()
          })
          return child
        }
      }

      if (!realProject) {
        throw new Error(
          `selenita: project is not yet initialized. `
          + `Ensure defineProject() is called at module or describe scope, not inside a test callback.`,
        )
      }
      const value = (realProject as unknown as Record<string | symbol, unknown>)[prop]
      return typeof value === 'function' ? value.bind(realProject) : value
    },
  })
}
