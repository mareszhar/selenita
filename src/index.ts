export { SelenitaError } from './errors'
export { cursor, mark, snippet } from './markers'
export type { Cursor, Mark, Snippet } from './markers'
export { compareCompletions } from './parity'
export { createProject } from './project'

export type {
  CheckResult,
  CheckTag,
  CodeAction,
  CodeFix,
  CompilerOptionsJson,
  Completion,
  CompletionComparison,
  CompletionKind,
  Diagnostic,
  DocTag,
  Files,
  Hover,
  InlayHint,
  InspectionContext,
  Interpolation,
  JsonValue,
  Observations,
  Parameter,
  Plugin,
  PluginEntry,
  Point,
  Project,
  ProjectConfig,
  QueryResult,
  QueryTag,
  Range,
  RelatedInformation,
  Rename,
  RenameLocation,
  Signature,
  SignatureHelp,
  TextEdit,
} from './types'
