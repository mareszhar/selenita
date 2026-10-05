import type { ResolvedConfig } from './config'
import type { Fixture } from './fixture'
import type { CheckTag, Files, Interpolation, Project, ProjectConfig, QueryTag } from './types'
import { resolveConfig } from './config'
import { SelenitaError } from './errors'
import { createFixture } from './fixture'
import { ProjectHost } from './host'
import { createResult } from './results'
import ts, { documentRegistry as sharedDocumentRegistry } from './typescript'

/** Construct a caller-owned editor environment from configuration layers. */
export function createProject(...configs: ProjectConfig[]): Project {
  return new ProjectRuntime(configs)
}

/** @internal The resource owner; public users only see the Project interface. */
export class ProjectRuntime implements Project {
  readonly config: ResolvedConfig
  readonly host: ProjectHost
  private service: ts.LanguageService | undefined
  private initializationError: SelenitaError | undefined
  private isDisposed = false
  private readonly children = new Set<ProjectRuntime>()
  constructor(private readonly layers: readonly ProjectConfig[], private readonly parent?: ProjectRuntime, private readonly registry: ts.DocumentRegistry = sharedDocumentRegistry) {
    this.config = resolveConfig(layers)
    this.host = new ProjectHost(this.config)
  }

  query = ((input: Files | TemplateStringsArray, ...values: Interpolation[]) => {
    this.validateOwnership('query')
    return createResult(this, createFixture(this.config.root, input, values, 'query'), true)
  }) as QueryTag

  check = ((input: Files | TemplateStringsArray, ...values: Interpolation[]) => {
    this.validateOwnership('check')
    return createResult(this, createFixture(this.config.root, input, values, 'check'), false)
  }) as CheckTag

  extend = (...configs: ProjectConfig[]): Project => {
    this.validateOwnership('extend')
    const child = new ProjectRuntime([...this.layers, ...configs], this)
    this.children.add(child)
    return child
  }

  private validateOwnership(action: string): void {
    if (this.isDisposed)
      throw new SelenitaError(`cannot ${action} on a disposed project\n  hint: create a new project for unread observations`)
  }

  private requireService(): ts.LanguageService {
    if (this.initializationError)
      throw this.initializationError
    if (!this.service) {
      let service = ts.createLanguageService(this.host, this.registry)
      try {
        for (const entry of this.config.plugins) {
          const [factory, config] = typeof entry === 'function' ? [entry, {}] as const : entry
          const logger = { close() {}, info() {}, msg() {}, perftrc() {}, startGroup() {}, endGroup() {}, loggingEnabled: () => false, hasLevel: () => false, getLogFileName: () => undefined }
          const project = createPluginBoundary({
            getCurrentDirectory: () => this.config.root,
            getCompilerOptions: () => this.config.options,
            getProjectName: () => this.config.root,
            projectService: createPluginBoundary({ logger }, 'project.projectService'),
          }, 'project')
          const info = createPluginBoundary({ languageService: service, languageServiceHost: this.host, config, project }, 'info')
          service = factory({ typescript: ts }).create(info as unknown as ts.server.PluginCreateInfo)
        }
        this.service = service
      }
      catch (cause) {
        service.dispose()
        this.initializationError = cause instanceof SelenitaError ? cause : new SelenitaError(`could not create language-service plugin\n  backend: TypeScript ${ts.version}\n  hint: check the plugin factory and its configuration`, { cause })
        throw this.initializationError
      }
    }
    return this.service
  }

  activateFixture(fixture: Fixture, observation: string): ts.LanguageService {
    this.validateOwnership(`read ${observation}`)
    this.host.activateFixture(fixture)
    return this.requireService()
  }

  warmUp = (): void => {
    this.validateOwnership('warm up')
    this.requireService().getProgram()
  }

  dispose = (): void => {
    if (this.isDisposed)
      return
    this.isDisposed = true
    for (const child of this.children)
      child.dispose()
    this.children.clear()
    this.service?.dispose()
    this.service = undefined
    this.parent?.children.delete(this)
  }

  [Symbol.dispose] = (): void => this.dispose()
}
function createPluginBoundary<Value extends object>(members: Value, path: string): Value {
  return new Proxy(members, {
    get(target, member, receiver) {
      if (!Object.hasOwn(target, member))
        throw new SelenitaError(`plugin host does not provide ${path === 'info' ? '' : `${path}.`}${String(member)}\n  hint: this plugin member needs a full tsserver host`)
      return Reflect.get(target, member, receiver)
    },
  })
}
