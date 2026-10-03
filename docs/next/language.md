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
                                                     rename · diagnostics · fixes
                                       │
                                       └── located by ranges
```

| Term | Meaning | Not to be confused with |
| --- | --- | --- |
| **project** | A TypeScript environment configured like your user's editor: tsconfig, virtual files, aliases, plugins. Owns one language service. | Your repository or package. |
| **fixture** | The source one query runs against: an anonymous file (template form) or named files (record form). | Disk test fixtures — though fixture files may overlay real files. |
| **marker** | A cursor or a mark. Markers are JavaScript values interpolated into fixture source. | Comments or sentinel strings. selenita has none. |
| **cursor** | A point between two characters, exactly like the editor's caret. Where you ask the editor a question. | A selection. A cursor has no extent. |
| **mark** | Named fixture text, written ``mark('name')`text` ``. Locates text; observable at its start. | A cursor. Marks locate; cursors ask. |
| **snippet** | Reusable fixture source carrying its own markers. Inert until interpolated. | A string, which carries no markers. |
| **scope** | The dotted prefix `.for(scope)` adds to a snippet's marker names: `list.filter`. | A TypeScript scope. |
| **query** | Run a fixture and ask questions at its cursors. `project.query` | — |
| **check** | Run a fixture for its diagnostics only. `project.check` | — |
| **result** | What `query`/`check` return: file-wide observations plus access to each marker. | A test result. |
| **observation** | One thing the editor reported, e.g. `completions` or `hover`. Plain, frozen, lazy. | A matcher. |
| **completions** | The names the editor suggests at a cursor. The data noun; **suggest** is its verb. | Completion *details* (`completionItem`). |
| **display** | TypeScript's rendering of a symbol: `(property) name: string`. Presentation, not type identity. | The symbol's type. Display is text. |
| **documentation** | The prose attached to a symbol (TSDoc), without tags. | `display`, or the whole tooltip (`text`). |
| **diagnostic** | Something the editor underlines: an error, warning, suggestion, or message. **errors** are diagnostics with severity `error`. | Exceptions. |
| **range** | Located text: `file`, `start`, `end` (exclusive), `text`. Every location in selenita is a range. | TypeScript's `TextSpan`. |
| **parity** | Equal completion sets for the same cursor across scopes. | Equal display or equal order. |
| **plugin** | A TypeScript language-service plugin factory, exactly as tsserver loads it. | Vitest or bundler plugins. |
| **backend** | The TypeScript implementation that produces observations (today: the TypeScript 6 API). | Your project's `typescript` version. |

## 2. Naming rules

**One spelling per concept.** No aliases, no deprecated names kept alive. A renamed concept leaves no trace in code, types, or docs; the changelog owns migration.

**Verbs say who owns the result:**

| Prefix | Meaning | Examples |
| --- | --- | --- |
| `create*` | Construct a resource the caller owns and disposes. | `createProject` |
| `define*` | Declare a resource whose lifecycle a runner manages. | `defineProject` (Vitest) |
| `to*` | A matcher. Reads as a sentence after `expect(x)`: `toSuggest`, `toHaveError`. | — |

**Result accessors are short prepositions or nouns:**

| Accessor | Reads as | Returns |
| --- | --- | --- |
| `result.at(name)` | observations **at** a marker | observations |
| `result.range(name)` | the **range** of a marker | `Range` |
| `result.across(name)` | a cursor **across** every scope | record of observations |
| `result.raw(fn)` | **raw** TypeScript access | whatever `fn` returns |

**Data fields are nouns; booleans are adjectives.** `deprecated`, `optional`, `canRename` (TypeScript's own word, kept for fidelity). No `is*` prefixes on data.

**TypeScript owns TypeScript vocabulary.** When selenita exposes a TypeScript concept, it keeps TypeScript's meaning: `kind` is TypeScript's `ScriptElementKind`; `compilerOptions` use tsconfig.json spelling. selenita coins words only for its own concepts (fixture, marker, mark, scope, parity).

**Marker names are paths.** `.for(scope)` joins scopes with `.`, so a name reads outside-in: `ctx.inner.field`. A cursor or mark name is one non-empty segment without `.` or whitespace; a scope is any non-empty string (an API name such as `db.findMany` is a fine scope). `across(name)` keys each entry by everything before the final segment.

## 3. Error messages

An error message is part of the API. Every selenita error has three parts: **what happened**, **the context that locates it**, and **the fix**.

```text
selenita: unknown cursor 'optoins'
  this query has cursors: root, options
  hint: check the spelling — names autocomplete inside result.at('…')
```

```text
selenita: could not collect completions at cursor 'member'
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
