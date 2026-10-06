import type { Fixture, FixtureMarker } from './fixture'
import type { ObservationContext } from './observations'
import type { ProjectRuntime } from './project'
import type { CheckResult, InspectionContext, Observations, QueryResult } from './types'
import { resolve } from 'node:path'
import { SelenitaError } from './errors'
import { createLazyField, createLazyValue, freezeData } from './laziness'
import { collectCompletions, collectDiagnostics, collectHover, collectInlayHints, collectRename, collectSignatureHelp } from './observations'
import { createRange, fixtureReference, markerReference } from './ranges'
import ts from './typescript'

const observationNames = ['completionNames', 'completions', 'hover', 'signatureHelp', 'rename'] as const
/** A frozen lazy view that always observes its own fixture. */
export function createResult(project: ProjectRuntime, fixture: Fixture, isQuery: boolean): QueryResult | CheckResult {
  const result = {} as QueryResult
  const context: ObservationContext = { project, fixture, observation: { kind: 'diagnostics' } }
  const observations = new Map<FixtureMarker, Observations>()
  const cursors = [...fixture.markers.values()].filter(marker => marker.kind === 'cursor')
  const requireObservations = (marker: FixtureMarker): Observations => {
    const cachedObservations = observations.get(marker)
    if (cachedObservations)
      return cachedObservations
    const value = createObservations({ project, fixture, marker, observation: { kind: 'completions' } })
    observations.set(marker, value)
    return value
  }
  const requireMarker = (name: string): FixtureMarker => {
    const marker = fixture.markers.get(name)
    if (!marker)
      throw new SelenitaError(`unknown marker '${name}'${fixture.isBare ? ' — the bare cursor has no name' : ''}\n  available names: ${[...fixture.markers.keys()].filter(Boolean).join(', ') || '(none)'}\n  hint: ${fixture.isBare ? 'read the bare cursor directly from the result, or use a named mark' : 'check the marker spelling; names autocomplete'}`)
    return marker
  }
  Object.defineProperties(result, {
    [fixtureReference]: { value: fixture },
    files: { enumerable: true, value: Object.freeze(Object.fromEntries([...fixture.files.values()].map(file => [file.key, file.text]))) },
    rangeOf: { value(name: string) {
      const marker = requireMarker(name)
      return createRange(project.config.root, marker.file, fixture.files.get(marker.file)!.text, marker.start, marker.end - marker.start, fixture)
    } },
    inspect: { value<Value>(runInspection: (context: InspectionContext) => Value): Value {
      const { service } = project.activateObservation(fixture, 'inspect', {})
      const value = runInspection({ service, typescript: ts, resolvePath: file => resolve(project.config.root, file) })
      if (value !== null && (typeof value === 'object' || typeof value === 'function') && 'then' in value && typeof value.then === 'function')
        throw new SelenitaError('inspect callback returned a thenable\n  hint: inspect synchronously while this fixture is active')
      return value
    } },
  })
  const requireSyntactic = createLazyValue(() => collectDiagnostics(context, 'getSyntacticDiagnostics'))
  const requireSemantic = createLazyValue(() => collectDiagnostics(context, 'getSemanticDiagnostics'))
  const requireSuggestion = createLazyValue(() => collectDiagnostics(context, 'getSuggestionDiagnostics'))
  for (const [name, createValue] of Object.entries({
    errors: () => [...requireSyntactic(), ...requireSemantic()].filter(diagnostic => diagnostic.severity === 'error'),
    diagnostics: () => [...requireSyntactic(), ...requireSemantic(), ...requireSuggestion()],
    inlayHints: () => collectInlayHints(context),
  })) {
    createLazyField(result, name, () => {
      project.activateFixture(fixture, name)
      const value = createValue()
      Object.defineProperty(value, fixtureReference, { value: fixture })
      return value
    })
  }
  if (isQuery) {
    Object.defineProperties(result, {
      at: { value: (name: string) => requireObservations(requireMarker(name)) },
      atEach: { value(name: string, scopes?: readonly string[]) {
        const members = [...fixture.markers.values()].filter(marker => marker.name?.endsWith(`.${name}`))
        if (!members.length)
          throw new SelenitaError(`no scoped marker '${name}'\n  available names: ${[...fixture.markers.keys()].filter(Boolean).join(', ') || '(none)'}\n  hint: check the marker name and scope each snippet`)
        const byScope = new Map(members.map(marker => [marker.name!.slice(0, -(name.length + 1)), marker]))
        const selectedScopes = scopes ?? [...byScope.keys()]
        return freezeData(Object.fromEntries(selectedScopes.map((scope) => {
          const marker = byScope.get(scope)
          if (!marker)
            throw new SelenitaError(`scope '${scope}' has no marker '${name}'\n  available scopes: ${[...byScope.keys()].join(', ')}\n  hint: restore the missing marker before comparing members`)
          return [scope, requireObservations(marker)]
        })))
      } },
    })
    if (cursors.length === 1) {
      const cursorObservations = requireObservations(cursors[0]!)
      Object.defineProperty(result, markerReference, { value: cursors[0] })
      for (const name of [...observationNames, 'findCompletion'] as const)
        Object.defineProperty(result, name, Object.getOwnPropertyDescriptor(cursorObservations, name)!)
    }
    else {
      const requireSingleCursor = (): never => {
        throw new SelenitaError(`single-cursor observations need exactly one cursor\n  cursors: ${cursors.map(marker => marker.name).join(', ') || '(none; this fixture has marks only)'}\n  hint: read observations with result.at(name)`)
      }
      for (const name of observationNames)
        createLazyField(result, name, requireSingleCursor, false)
      Object.defineProperty(result, 'findCompletion', { value: requireSingleCursor })
    }
  }
  return Object.freeze(result)
}
function createObservations(context: ObservationContext): Observations {
  const observations = {} as Observations
  Object.defineProperties(observations, {
    [fixtureReference]: { value: context.fixture },
    [markerReference]: { value: context.marker },
  })
  const requireCompletions = createLazyValue(() => collectCompletions(context))
  for (const [name, createValue] of Object.entries({
    completionNames: () => requireCompletions().map(completion => completion.name),
    completions: requireCompletions,
    hover: () => collectHover(context),
    signatureHelp: () => collectSignatureHelp(context),
    rename: () => collectRename(context),
  })) {
    createLazyField(observations, name, () => {
      context.project.activateFixture(context.fixture, name)
      return createValue()
    })
  }
  Object.defineProperty(observations, 'findCompletion', { value(selector: string | { name: string, source?: string }) {
    return observations.completions.find(completion => typeof selector === 'string' ? completion.name === selector : completion.name === selector.name && (selector.source === undefined || completion.source === selector.source))
  } })
  return Object.freeze(observations)
}
