import type { Fixture, FixtureMarker } from './fixture'
import type { ProjectRuntime } from './project'
import type { CodeAction, CodeFix, Completion, Diagnostic, DocTag, Hover, InlayHint, Range, Rename, SignatureHelp, TextEdit } from './types'
import { relative, resolve } from 'node:path'
import { SelenitaError } from './errors'
import { createLazyField, createLazyValue, freezeData } from './laziness'
import { applyEdits, createRange, fixtureReference, formatExcerpt } from './ranges'
import ts from './typescript'

export interface ObservationContext { project: ProjectRuntime, fixture: Fixture, marker?: FixtureMarker, file?: string }
export function collectRequest<Value>(context: ObservationContext, request: string, collectResponse: (service: ts.LanguageService) => Value): Value {
  const service = context.project.activateFixture(context.fixture, request)
  try {
    return collectResponse(service)
  }
  catch (cause) {
    const marker = context.marker
    const file = marker?.file ?? context.file ?? context.fixture.files.keys().next().value
    const range = file ? createObservationRange(context, file, marker?.start ?? 0, (marker?.end ?? 0) - (marker?.start ?? 0)) : null
    const observation = request.replace(/^get/u, '').replace(/AtPosition$/u, '').replace(/([a-z])([A-Z])/gu, '$1 $2').toLowerCase()
    throw new SelenitaError(`could not collect ${observation} (${request})${marker?.name ? ` at ${marker.kind} '${marker.name}'` : ''}\n${range ? `${formatExcerpt(range)}\n` : ''}  backend: TypeScript ${ts.version}\n  cause: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
  }
}
export function createObservationRange(context: ObservationContext, file: string, start: number, length: number): Range {
  const text = context.fixture.files.get(file)?.text ?? context.project.host.readFile(file) ?? ''
  return createRange(context.project.config.root, file, text, start, length, context.fixture)
}
function createTags(tags: readonly ts.JSDocTagInfo[] | undefined): readonly DocTag[] {
  return (tags ?? []).map(tag => ({ name: tag.name, text: ts.displayPartsToString(tag.text) }))
}
function createLocatedValue<Value extends object>(context: ObservationContext, value: Value): Value {
  Object.defineProperty(value, fixtureReference, { value: context.fixture })
  return value
}
export function collectCompletions(context: ObservationContext): readonly Completion[] {
  const marker = context.marker!
  const preferences = context.project.config.preferences
  const list = collectRequest(context, 'getCompletionsAtPosition', service => service.getCompletionsAtPosition(marker.file, marker.start, preferences))
  return (list?.entries ?? []).map((entry): Completion => {
    const modifiers = entry.kindModifiers?.split(',') ?? []
    const completion = createLocatedValue(context, {
      name: entry.name.replace(/^(['"])(.*)\1$/su, '$2'),
      kind: entry.kind,
      isDeprecated: modifiers.includes('deprecated'),
      isOptional: modifiers.includes('optional'),
      isRecommended: entry.isRecommended ?? false,
      source: entry.sourceDisplay ? ts.displayPartsToString(entry.sourceDisplay) : entry.source ?? null,
      insertText: entry.insertText ?? null,
      replacementRange: entry.replacementSpan ? createObservationRange(context, marker.file, entry.replacementSpan.start, entry.replacementSpan.length) : null,
      sortText: entry.sortText,
    }) as Completion
    const requireDetails = createLazyValue(() => collectRequest(context, 'getCompletionEntryDetails', service => service.getCompletionEntryDetails(marker.file, marker.start, entry.name, {}, entry.source, preferences, entry.data)))
    for (const [name, createValue] of Object.entries({
      displayText: () => ts.displayPartsToString(requireDetails()?.displayParts),
      documentation: () => ts.displayPartsToString(requireDetails()?.documentation),
      tags: () => createTags(requireDetails()?.tags),
      codeActions: () => (requireDetails()?.codeActions ?? []).map(action => createCodeAction(context, action)),
    })) {
      createLazyField(completion, name, () => {
        context.project.activateFixture(context.fixture, `completion.${name}`)
        return createValue()
      })
    }
    return completion
  })
}
export function collectHover(context: ObservationContext): Hover | null {
  const marker = context.marker!
  const info = collectRequest(context, 'getQuickInfoAtPosition', service => service.getQuickInfoAtPosition(marker.file, marker.start, context.project.config.preferences.maximumHoverLength))
  if (!info)
    return null
  const displayText = ts.displayPartsToString(info.displayParts)
  const documentation = ts.displayPartsToString(info.documentation)
  const tags = createTags(info.tags)
  return createLocatedValue(context, { displayText, documentation, tags, text: [displayText, documentation, tags.map(tag => `@${tag.name}${tag.text ? ` ${tag.text}` : ''}`).join('\n')].filter(Boolean).join('\n\n'), range: createObservationRange(context, marker.file, info.textSpan.start, info.textSpan.length) })
}
export function collectSignatureHelp(context: ObservationContext): SignatureHelp | null {
  const marker = context.marker!
  const help = collectRequest(context, 'getSignatureHelpItems', service => service.getSignatureHelpItems(marker.file, marker.start, undefined))
  if (!help)
    return null
  const signatures = help.items.map((item) => {
    const parameters = item.parameters.map(parameter => ({ name: parameter.name, label: ts.displayPartsToString(parameter.displayParts), documentation: ts.displayPartsToString(parameter.documentation) }))
    return { label: ts.displayPartsToString(item.prefixDisplayParts) + parameters.map(parameter => parameter.label).join(ts.displayPartsToString(item.separatorDisplayParts)) + ts.displayPartsToString(item.suffixDisplayParts), documentation: ts.displayPartsToString(item.documentation), tags: createTags(item.tags), parameters }
  })
  const activeSignature = signatures[help.selectedItemIndex]!
  return { signatures, activeSignature, activeParameter: activeSignature.parameters[help.argumentIndex] ?? null, activeSignatureIndex: help.selectedItemIndex, activeParameterIndex: help.argumentIndex }
}
export function collectRename(context: ObservationContext): Rename {
  const marker = context.marker!
  const preferences = context.project.config.preferences
  const info = collectRequest(context, 'getRenameInfo', service => service.getRenameInfo(marker.file, marker.start, preferences))
  if (!info.canRename)
    return { canRename: false, reason: info.localizedErrorMessage, locations: [] }
  const locations = collectRequest(context, 'findRenameLocations', service => service.findRenameLocations(marker.file, marker.start, false, false, { ...preferences, providePrefixAndSuffixTextForRename: true })) ?? []
  return { canRename: true, reason: null, locations: locations.map(location => createLocatedValue(context, { ...createObservationRange(context, location.fileName, location.textSpan.start, location.textSpan.length), ...(location.prefixText ? { prefixText: location.prefixText } : {}), ...(location.suffixText ? { suffixText: location.suffixText } : {}) })).sort(compareLocations) }
}
function compareLocations(first: { file: string, start: { offset: number } }, second: { file: string, start: { offset: number } }): number {
  return first.file < second.file ? -1 : first.file > second.file ? 1 : first.start.offset - second.start.offset
}
function createFileNames(context: ObservationContext): string[] {
  return [...context.fixture.files.keys()].sort((first, second) => relative(context.fixture.root, first).localeCompare(relative(context.fixture.root, second)))
}
export function collectInlayHints(context: ObservationContext): readonly InlayHint[] {
  const hints: InlayHint[] = []
  for (const file of createFileNames(context)) {
    const text = context.fixture.files.get(file)!.text
    const response = collectRequest({ ...context, file }, 'provideInlayHints', service => service.provideInlayHints(file, { start: 0, length: text.length }, context.project.config.preferences))
    for (const hint of response)
      hints.push(createLocatedValue(context, { text: hint.text ?? hint.displayParts?.map(part => part.text).join('') ?? '', kind: hint.kind === ts.InlayHintKind.Parameter ? 'parameter' : hint.kind === ts.InlayHintKind.Enum ? 'enum' : 'type', range: createObservationRange(context, file, hint.position, 0) }))
  }
  return hints.sort((first, second) => compareLocations(first.range, second.range))
}
export function collectDiagnostics(context: ObservationContext, request: 'getSyntacticDiagnostics' | 'getSemanticDiagnostics' | 'getSuggestionDiagnostics'): readonly Diagnostic[] {
  const diagnostics: Diagnostic[] = []
  for (const file of createFileNames(context)) {
    const response = collectRequest({ ...context, file }, request, service => service[request](file))
    for (const diagnostic of [...response].sort((first, second) => (first.start ?? -1) - (second.start ?? -1)))
      diagnostics.push(createDiagnostic(context, diagnostic))
  }
  return diagnostics
}
function createDiagnostic(context: ObservationContext, native: ts.Diagnostic): Diagnostic {
  const severities = { [ts.DiagnosticCategory.Error]: 'error', [ts.DiagnosticCategory.Warning]: 'warning', [ts.DiagnosticCategory.Suggestion]: 'suggestion', [ts.DiagnosticCategory.Message]: 'message' } as const
  const createDiagnosticRange = (diagnostic: ts.Diagnostic) => diagnostic.file && diagnostic.start !== undefined ? createObservationRange(context, diagnostic.file.fileName, diagnostic.start, diagnostic.length ?? 0) : null
  const diagnostic = createLocatedValue(context, { code: native.code, severity: severities[native.category], message: ts.flattenDiagnosticMessageText(native.messageText, '\n'), range: createDiagnosticRange(native), relatedInformation: (native.relatedInformation ?? []).map(info => ({ message: ts.flattenDiagnosticMessageText(info.messageText, '\n'), range: createDiagnosticRange(info) })) })
  return createLazyField(diagnostic, 'codeFixes', () => {
    context.project.activateFixture(context.fixture, 'diagnostic.codeFixes')
    if (!native.file || native.start === undefined)
      return []
    const fixes = collectRequest({ ...context, file: native.file.fileName }, 'getCodeFixesAtPosition', service => service.getCodeFixesAtPosition(native.file!.fileName, native.start!, native.start! + (native.length ?? 0), [native.code], {}, context.project.config.preferences))
    return fixes.map(fix => createCodeFix(context, fix))
  })
}
function createEdits(context: ObservationContext, changes: readonly ts.FileTextChanges[]): readonly TextEdit[] {
  return changes.flatMap(change => change.textChanges.map(edit => ({ range: createObservationRange(context, change.fileName, edit.span.start, edit.span.length), newText: edit.newText })))
}
function createCodeAction(context: ObservationContext, action: ts.CodeAction): CodeAction {
  return { description: action.description, edits: createEdits(context, action.changes) }
}
function createCodeFix(context: ObservationContext, native: ts.CodeFixAction): CodeFix {
  const fix = createCodeAction(context, native) as CodeFix
  createLazyField(fix, 'fixedFiles', () => {
    context.project.activateFixture(context.fixture, 'codeFix.fixedFiles')
    if (native.commands?.length)
      throw new SelenitaError(`cannot produce fixedFiles for editor command '${native.commands.map(command => 'type' in command ? String(command.type) : JSON.stringify(command)).join(', ')}'\n  hint: inspect the edits or run this fix in an editor`)
    const sourceFiles = Object.fromEntries([...context.fixture.files].map(([file, source]) => [createObservationRange(context, file, 0, 0).file, source.text]))
    for (const edit of fix.edits) {
      if (!(edit.range.file in sourceFiles))
        sourceFiles[edit.range.file] = context.project.host.readFile(resolve(context.project.config.root, edit.range.file)) ?? ''
    }
    return applyEdits(sourceFiles, fix.edits)
  })
  return freezeData(fix)
}
