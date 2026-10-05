import type { PluginEntry, ProjectConfig } from './types'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { SelenitaError } from './errors'
import ts from './typescript'

export interface ResolvedConfig {
  root: string
  options: ts.CompilerOptions
  rootFiles: readonly string[]
  files: Readonly<Record<string, string>>
  preferences: ts.UserPreferences
  plugins: readonly PluginEntry[]
}
const configKeys = ['tsconfig', 'compilerOptions', 'preferences', 'files', 'aliases', 'plugins']
type PreferenceRule = 'boolean' | 'string' | 'string[]' | 'positive integer' | readonly (string | boolean)[]
// Keep the runtime boundary complete when the bundled backend adds a preference.
const preferenceRules = {
  disableSuggestions: 'boolean',
  quotePreference: ['auto', 'double', 'single'],
  includeCompletionsForModuleExports: 'boolean',
  includeCompletionsForImportStatements: 'boolean',
  includeCompletionsWithSnippetText: 'boolean',
  includeAutomaticOptionalChainCompletions: 'boolean',
  includeCompletionsWithInsertText: 'boolean',
  includeCompletionsWithClassMemberSnippets: 'boolean',
  includeCompletionsWithObjectLiteralMethodSnippets: 'boolean',
  useLabelDetailsInCompletionEntries: 'boolean',
  allowIncompleteCompletions: 'boolean',
  importModuleSpecifierPreference: ['shortest', 'project-relative', 'relative', 'non-relative'],
  importModuleSpecifierEnding: ['auto', 'minimal', 'index', 'js'],
  allowTextChangesInNewFiles: 'boolean',
  providePrefixAndSuffixTextForRename: 'boolean',
  includePackageJsonAutoImports: ['auto', 'on', 'off'],
  provideRefactorNotApplicableReason: 'boolean',
  jsxAttributeCompletionStyle: ['auto', 'braces', 'none'],
  includeInlayParameterNameHints: ['none', 'literals', 'all'],
  includeInlayParameterNameHintsWhenArgumentMatchesName: 'boolean',
  includeInlayFunctionParameterTypeHints: 'boolean',
  includeInlayVariableTypeHints: 'boolean',
  includeInlayVariableTypeHintsWhenTypeMatchesName: 'boolean',
  includeInlayPropertyDeclarationTypeHints: 'boolean',
  includeInlayFunctionLikeReturnTypeHints: 'boolean',
  includeInlayEnumMemberValueHints: 'boolean',
  interactiveInlayHints: 'boolean',
  allowRenameOfImportPath: 'boolean',
  autoImportFileExcludePatterns: 'string[]',
  autoImportSpecifierExcludeRegexes: 'string[]',
  preferTypeOnlyAutoImports: 'boolean',
  organizeImportsIgnoreCase: ['auto', true, false],
  organizeImportsCollation: ['ordinal', 'unicode'],
  organizeImportsLocale: 'string',
  organizeImportsNumericCollation: 'boolean',
  organizeImportsAccentCollation: 'boolean',
  organizeImportsCaseFirst: ['upper', 'lower', false],
  organizeImportsTypeOrder: ['last', 'inline', 'first'],
  excludeLibrarySymbolsInNavTo: 'boolean',
  lazyConfiguredProjectsFromExternalProject: 'boolean',
  displayPartsForJSDoc: 'boolean',
  generateReturnInDocTemplate: 'boolean',
  disableLineTextInReferences: 'boolean',
  maximumHoverLength: 'positive integer',
} satisfies { [Key in keyof ts.UserPreferences]-?: PreferenceRule }
export const defaultPreferences: ts.UserPreferences = {
  includeCompletionsWithInsertText: true,
  includeAutomaticOptionalChainCompletions: true,
  includeCompletionsForModuleExports: false,
  includeInlayParameterNameHints: 'all',
  includeInlayParameterNameHintsWhenArgumentMatchesName: true,
  includeInlayFunctionParameterTypeHints: true,
  includeInlayVariableTypeHints: true,
  includeInlayVariableTypeHintsWhenTypeMatchesName: true,
  includeInlayPropertyDeclarationTypeHints: true,
  includeInlayFunctionLikeReturnTypeHints: true,
  includeInlayEnumMemberValueHints: true,
}
function validateRecord(value: unknown, key: string, shouldRequireStrings = false): void {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (shouldRequireStrings && Object.values(value).some(item => typeof item !== 'string')))
    throw new SelenitaError(`invalid ${key}\n  hint: pass a record${shouldRequireStrings ? ' of strings' : ''}`)
}
export function validateConfig(config: ProjectConfig): void {
  validateRecord(config, 'configuration layer')
  for (const key of Object.keys(config)) {
    if (!configKeys.includes(key))
      throw new SelenitaError(`unknown configuration key '${key}'\n  valid keys: ${configKeys.join(', ')}\n  hint: check the option spelling`)
  }
  if (config.tsconfig !== undefined && config.tsconfig !== false && (typeof config.tsconfig !== 'string' || !config.tsconfig))
    throw new SelenitaError('invalid tsconfig\n  hint: pass a path or false for in-memory defaults')
  if (typeof config.tsconfig === 'string')
    resolveTsconfig(resolve(config.tsconfig))
  for (const key of ['compilerOptions', 'preferences', 'files', 'aliases'] as const) {
    if (config[key] !== undefined)
      validateRecord(config[key], key, key === 'files' || key === 'aliases')
  }
  for (const [key, value] of Object.entries(config.preferences ?? {})) {
    if (!Object.hasOwn(preferenceRules, key))
      throw new SelenitaError(`unknown preference '${key}'\n  hint: use a TypeScript UserPreferences key; check the spelling`)
    const rule: PreferenceRule = preferenceRules[key as keyof ts.UserPreferences]
    const isValid = value === undefined || (Array.isArray(rule)
      ? rule.includes(value)
      : rule === 'boolean'
        ? typeof value === 'boolean'
        : rule === 'string'
          ? typeof value === 'string'
          : rule === 'string[]'
            ? Array.isArray(value) && value.every(item => typeof item === 'string')
            : typeof value === 'number' && Number.isInteger(value) && value > 0)
    if (!isValid)
      throw new SelenitaError(`invalid preference '${key}'\n  hint: pass ${Array.isArray(rule) ? rule.map(item => JSON.stringify(item)).join(' or ') : rule}`)
  }
  if (config.compilerOptions) {
    const convertedOptions = ts.convertCompilerOptionsFromJson(config.compilerOptions, process.cwd())
    if (convertedOptions.errors.length)
      throw new SelenitaError(`invalid compilerOptions\n  ${convertedOptions.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n  ')}\n  hint: use tsconfig.json option names and values`)
  }
  if (config.plugins !== undefined) {
    if (!Array.isArray(config.plugins))
      throw new SelenitaError('invalid plugins\n  hint: pass a list of plugin factories or [factory, config] pairs')
    for (const entry of config.plugins) {
      if (typeof entry === 'function')
        continue
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== 'function')
        throw new SelenitaError('invalid plugin entry\n  hint: pass a plugin factory or [factory, config] pair')
      validateRecord(entry[1], 'plugin config')
    }
  }
}
export function mergeLayers(configs: readonly ProjectConfig[]): ProjectConfig {
  let mergedConfig: ProjectConfig = {}
  for (const config of configs) {
    validateConfig(config)
    mergedConfig = {
      ...mergedConfig,
      ...(config.tsconfig !== undefined ? { tsconfig: config.tsconfig } : {}),
      compilerOptions: { ...mergedConfig.compilerOptions, ...config.compilerOptions },
      preferences: { ...mergedConfig.preferences, ...config.preferences },
      files: { ...mergedConfig.files, ...config.files },
      aliases: { ...mergedConfig.aliases, ...config.aliases },
      plugins: [...(mergedConfig.plugins ?? []), ...(config.plugins ?? [])],
    }
  }
  return mergedConfig
}
export function resolveConfig(configs: readonly ProjectConfig[]): ResolvedConfig {
  const config = mergeLayers(configs)
  const path = config.tsconfig === false ? undefined : config.tsconfig === undefined ? ts.findConfigFile(process.cwd(), ts.sys.fileExists) : resolve(config.tsconfig)
  const root = path ? dirname(path) : process.cwd()
  let options: ts.CompilerOptions = { strict: true, target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, lib: ['lib.es2022.d.ts'], skipLibCheck: true }
  let rootFiles: readonly string[] = []
  if (path) {
    const parsedConfig = resolveTsconfig(path)
    options = parsedConfig.options
    rootFiles = parsedConfig.fileNames
  }
  const convertedOptions = ts.convertCompilerOptionsFromJson(config.compilerOptions ?? {}, root)
  if (convertedOptions.errors.length)
    throw new SelenitaError(`invalid compilerOptions\n  ${convertedOptions.errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n  ')}\n  hint: use tsconfig.json option values`)
  options = { ...options, ...convertedOptions.options }
  if (Object.keys(config.aliases ?? {}).length)
    options.paths = { ...options.paths, ...Object.fromEntries(Object.entries(config.aliases!).map(([name, path]) => [name, [resolve(root, path)]])) }
  // An input-free program checks combinations without reading files or warming the service.
  validateCompilerOptions(ts.createProgram([], options).getOptionsDiagnostics())
  return { root, options, rootFiles, files: config.files ?? {}, preferences: { ...defaultPreferences, ...config.preferences }, plugins: config.plugins ?? [] }
}

export function validateCompilerOptions(diagnostics: readonly ts.Diagnostic[]): void {
  if (diagnostics.length)
    throw new SelenitaError(`invalid effective compilerOptions\n  ${diagnostics.map(diagnostic => `[TS${diagnostic.code}] ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`).join('\n  ')}\n  hint: correct the tsconfig and configuration layers so their combined options are valid`)
}

function resolveTsconfig(path: string): ts.ParsedCommandLine {
  const source = ts.readConfigFile(path, ts.sys.readFile)
  if (source.error)
    throw new SelenitaError(`could not read tsconfig '${path}'\n  ${ts.flattenDiagnosticMessageText(source.error.messageText, '\n')}\n  hint: check that the resolved path is readable`)
  const parsedConfig = ts.parseJsonConfigFileContent(source.config, ts.sys, dirname(path), undefined, path)
  const errors = parsedConfig.errors.filter(error => error.code !== 18003)
  if (errors.length)
    throw new SelenitaError(`invalid tsconfig '${path}'\n  ${errors.map(error => ts.flattenDiagnosticMessageText(error.messageText, '\n')).join('\n  ')}\n  hint: correct the tsconfig options`)
  return parsedConfig
}
