# selenita — language

selenita's language follows its model. Learn a word once and it means the same thing in code, types, error messages, and documentation. This document is the vocabulary, the naming rules that keep it predictable, and the house style for everything selenita writes.

## 1. Vocabulary

```text
project ──configures──▶ service
   │
   └── query / check ──▶ fixture ──contains──▶ markers ──▶ cursor  (a point)
                            │                         └──▶ mark    (some text)
                            ▼
                         result ──▶ observations ──▶ completions · hover · signature help ·
                                                     inlay hints · rename · diagnostics · code fixes
                                       │
                                       └── located by ranges
```

| Term | Meaning | Not to be confused with |
| --- | --- | --- |
| **project** | A TypeScript environment configured like your user's editor: tsconfig, preferences, virtual files, aliases, plugins. Owns one language service. | Your repository or package. |
| **layer** | One `ProjectConfig` in a stack; later layers refine earlier ones, as tsconfig `extends` does (`defineProject(base, extra)`, `project.extend(extra)`). | — |
| **preferences** | The editor's own settings (TypeScript's `UserPreferences`): what a typical editor sends unless you change it. | Compiler options. |
| **fixture** | The source one query runs against: an anonymous file (template form) or named files (record form). | Disk test fixtures — though fixture files may overlay real files. |
| **marker** | A cursor or a mark. Markers are JavaScript values interpolated into fixture source. | Comments or sentinel strings. selenita has none. |
| **cursor** | A point between two characters, exactly like the editor's caret. Where you ask the editor a question. | A selection. A cursor has no extent. |
| **mark** | Named fixture text, written ``mark('name')`text` ``. Locates text; observable at its start. | A cursor. Marks locate; cursors ask. |
| **snippet** | Reusable fixture source carrying its own markers, built by the template tag or `snippet.join(parts, separator)`. Inert until interpolated. | A string, which carries no markers. |
| **scope** | The dotted prefix `.scope(name)` adds to a snippet's marker names: `list.filter`. | A TypeScript scope. |
| **query** | Run a fixture and ask questions at its cursors. `project.query` | — |
| **check** | Run a fixture for its file-wide observations, such as diagnostics. `project.check` | — |
| **result** | What `query`/`check` return: file-wide observations plus access to each marker. | A test result. |
| **observation** | One thing the editor reported, named after the editor feature that produced it: `completions`, `hover`, `rename`. Plain, frozen, lazy. | A matcher. |
| **completion** | One suggestion the editor offers: its name, kind, what accepting it inserts, and its details. `completions` lists them; `completionNames` lists just their names. **Suggest** is the verb. | — |
| **inlay hint** | Text the editor draws inline in written code: `count:` before an argument, `: string` after a declaration. | Hover, which needs pointing at. |
| **display text** | TypeScript's rendering of a symbol: `(property) name: string`. Presentation, not type identity. | The symbol's type. |
| **documentation** | The prose attached to a symbol (TSDoc), without tags. | `displayText`, or the whole tooltip (`text`). |
| **diagnostic** | Something the editor underlines: an error, warning, suggestion, or message. **errors** are diagnostics with severity `error`. | Exceptions. |
| **code action** | Edits the editor offers alongside a suggestion (such as an auto-import) or for a diagnostic, with the files they produce. | — |
| **code fix** | A diagnostic's code action (VS Code's "quick fix"): `diagnostic.codeFixes`. | A completion's `codeActions`. |
| **range** | Located text: `file`, `start`, `end` (exclusive), `text`. Every location in selenita is a range. | TypeScript's `TextSpan`. |
| **parity** | Equal completion sets for the same cursor across scopes. | Equal display text or equal order. |
| **plugin** | A TypeScript language-service plugin, given as its standard factory. selenita hosts it with less than tsserver offers, and says when a plugin needs more. | Vitest or bundler plugins. |
| **backend** | The TypeScript implementation that produces observations (today: the TypeScript 6 API). | Your project's `typescript` version. |

## 2. Naming

> **A name tells you what kind of thing it is before you look it up.**

Read any identifier at its call site — in a test, in a doc, in `src/` — and you should know whether it is a value, a list, a yes-or-no fact, an action, or a lookup, and roughly what it holds, without hovering. Most of selenita's rules are the familiar ones (functions start with verbs, booleans ask a question); the few exceptions follow JavaScript's own precedent and are listed, so they are predictable too.

### 2.1 Shapes

| Kind of thing | Shape | selenita examples | Reads as |
| --- | --- | --- | --- |
| A value | singular noun | `hover`, `message`, `range`, `activeParameter` | "the hover" |
| A list | plural noun | `completions`, `errors`, `edits`, `locations` | "the completions" |
| A projection of richer data | noun + what it projects | `completionNames`, `displayText`, `sortText`, `prefixText` | "the names", "the text" |
| A position in a list, or a size | `…Index`, `…Count` | `activeParameterIndex`, `activeSignatureIndex` | "which one", "how many" |
| A yes-or-no fact | `is…`, `has…`, `can…`, `should…` | `isDeprecated`, `isOptional`, `isRecommended`, `hasParity`, `canRename` | a question: "is it deprecated?" |
| A yes-or-no setting | an instruction, as TypeScript names its own settings | `requireDocumentation`; TypeScript's `includeCompletionsWithInsertText`, `skipLibCheck` | a command: "require documentation" |
| An action | verb first | `createProject`, `defineProject`, `extend`, `warmUp`, `dispose`, `inspect`, `compareCompletions`, `query`, `check` | "do this" |
| A lookup that may find nothing | `find…`, returning `T \| undefined` (like `Array.prototype.find`) | `findCompletion` | "find it, if it is there" |
| A lookup that must succeed | where it looks, like `array.at(i)`; throws if the name is unknown | `at(name)`, `atEach(name, scopes)`, `rangeOf(name)` | "at the cursor", "the range of the mark" |
| A value you build fixtures from | the noun it puts in the fixture, like `html`, `css`, and `sql` tags | `cursor`, `mark`, `snippet` | "a cursor here" |
| An observation | the editor feature it observes (TypeScript and LSP names) | `completions`, `hover`, `signatureHelp`, `inlayHints`, `rename`, `diagnostics`, `codeFixes` | "the hover" — a noun, never called |
| A matcher | `to…`, finishing the sentence `expect(x)` starts (Vitest) | `toSuggest`, `toHaveError` | "expect x to suggest…" |
| A type | PascalCase noun | `Range`, `Completion`, `Observations` | — |
| A module | the noun it owns | `observations.ts`, `ranges.ts`, `parity.ts` | — |

Two notes on the exceptions. `hover` and `rename` are also verbs, but as observations they are always read, never called — `result.hover`, `result.at('use').rename.locations` — exactly as editors and the Language Server Protocol name those features. And lookups by marker name read as places (`at`, `atEach`, `rangeOf`) because they are pure and must succeed, the same reasoning that gave JavaScript `array.at(i)`; a lookup that may come back empty says so with `find`.

The test is a sentence at the call site:

```ts
if (completion.isDeprecated) { /* … */ }
for (const name of result.completionNames) { /* … */ }
result.findCompletion('red-apple')?.displayText
expect(result.atEach('root', dbs)).toHaveCompletionParity()
const strict = project.extend({ compilerOptions: { exactOptionalPropertyTypes: true } })
```

### 2.2 Verbs

Each verb has one meaning, everywhere:

| Verb | Means | Public | Internal |
| --- | --- | --- | --- |
| `create…` | Construct something new; the caller owns it | `createProject` | `createRange`, `createFixture` |
| `define…` | Declare something a runner manages | `defineProject` | — |
| `extend` | Derive a new one with more configuration layers, like tsconfig `extends`; never changes the original | `project.extend` | — |
| `find…` | Look something up; `undefined` when absent | `findCompletion` | `findMarker` |
| `require…` | Look something up; throw a `SelenitaError` when absent | — | `requireMarker` |
| `compare…` | Judge things against each other; return the judgment as data | `compareCompletions` | — |
| `inspect` | Run code against the raw TypeScript service, with a result's fixture active | `result.inspect` | — |
| `warmUp` / `dispose` | Prepare / release a resource | `project.warmUp`, `project.dispose` | — |
| `resolve…` | Turn something partial into its complete form: a path, a config, a module | `resolvePath` | `resolveConfig`, `resolveModule` |
| `collect…` | Request something from TypeScript and map it to public shapes | — | `collectCompletions`, `collectDiagnostics` |
| `join` | Compose fixture source with a separator, preserving markers | `snippet.join` | — |
| `merge…` | Combine configuration layers | — | `mergeLayers` |
| `activate` | Make a fixture the one the service sees | — | `activateFixture` |
| `apply…` | Produce new text from edits | — | `applyEdits` |
| `parse…` / `format…` | Text into structure / structure into text | — | `parseTemplate`, `formatExcerpt` |
| `flatten…` | Expand fixture composition into exact source text and marker locations | — | `flattenTemplate`, `flattenInterpolation` |
| `freeze…` | Make data immutable without evaluating lazy readers | — | `freezeData` |
| `run…` | Execute a command or operation | — | `runCommand` |
| `restore…` | Put captured state back after a failed operation | — | `restoreVersionFiles` |
| `validate…` | Throw a `SelenitaError` on invalid input | — | `validateConfig` |

A new verb is fine when none of these fits; add it here with its one meaning. Phrasal verbs capitalize both words (`warmUp`, not `warmup`, which is the noun).

### 2.3 Words

- **One spelling per concept.** No aliases, no deprecated names kept alive. A renamed concept leaves no trace in code, types, or docs; the changelog owns migration.
- **TypeScript owns TypeScript's words.** When selenita exposes a TypeScript concept, it keeps TypeScript's name and meaning: `codeFixes`, `codeActions`, `relatedInformation`, `insertText`, `sortText`, `prefixText`, `canRename`, `kind`, `compilerOptions` in tsconfig.json spelling, `preferences` as `UserPreferences`.
- **selenita coins words only for its own concepts:** fixture, marker, cursor, mark, snippet, scope, layer, observation, parity.
- **No abbreviations** beyond those the ecosystem spells that way (`config`, `tsconfig`, `ts`).
- **Marker names are paths.** `.scope(name)` joins scopes with `.`, so a name reads outside-in: `ctx.inner.field`. A cursor or mark name is one non-empty segment without `.` or whitespace; a scope is any non-empty string (an API name such as `db.findMany` is a fine scope). `atEach(name)` keys each entry by everything before the final segment.

## 3. Error messages

An error message is part of the API, read by people and by the agents that act on it. Every selenita error has three parts: **what happened**, **the context that locates it**, and **the fix**.

```text
selenita: unknown marker 'optoins'
  available names: root, options
  hint: check the marker spelling; names autocomplete
```

```text
selenita: could not collect completions (getCompletionsAtPosition) at cursor 'member'
  __selenita__.ts:4:9
    4 │ fruit.apple
      │       ^
  backend: TypeScript 6.0.3
  cause: <the original exception>
```

- Start with `selenita:` and a lowercase sentence fragment; no trailing period.
- Name the marker, option, or file involved, and list the valid alternatives when there are few.
- End with the most likely fix as a `hint:` line when there is one.
- Never apologize, never blame ("you did X wrong"), never guess beyond the evidence.

Matcher failures follow the same shape with the fixture excerpt in the middle (see the [matcher reference](./reference/matchers.md#failure-output)).

## 4. Writing style

For every document, docstring, and comment selenita ships:

- **Lead with intent.** Say what a thing is for and what it makes easy before specifying how it works. An API may change; its purpose usually does not.
- **Concrete by default.** Pair each contract with the smallest useful snippet, table, or diagram. Examples are real TypeScript a reader could paste.
- **Decisions, not deliberations.** State what selenita does. Rationale earns a sentence when it prevents a known mistake.
- **Current, not historical.** Describe how selenita works now. Docs never narrate what used to be; the changelog does.
- **One home per fact.** Link to the owner instead of restating. The reference owns exact behavior; guides own how-to; this document owns words.
- **Precise, not padded.** No hedging, no filler, no "simply". Real exceptions are stated plainly.
- **Renderer-owned layout.** One paragraph per line; Markdown wraps.

Code in docs follows the repository's lint style (single quotes, no semicolons, two-space indent) and is linted with the docs.

## 5. Naming tests

For selenita's own suite and for the examples in its docs:

- Name a test after the promise it protects, in the user's words: `suggests every verb on the client`, `reports an unknown key on the key itself`.
- One promise per test. Several assertions are fine when they establish one promise (presence, then absence, then count).
- Name markers after the moment they represent (`'empty'`, `'partial'`, `'typo'`), not their position (`'c1'`, `'line4'`).
