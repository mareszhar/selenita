# selenita — architecture

How selenita is built: the path from a template to an observation, the modules that own each step, and the invariants that keep its evidence trustworthy. Read this before changing `src/`.

## 1. The path of a query

```text
project.query`…${cursor('x')}…`        project.query({ 'a.ts': …, 'b.ts': … })
                 │                                     │
                 └──────────────┬──────────────────────┘
                                ▼
          fixture.ts   flatten interpolations → Fixture
                       { files: path → text, markers: name → { kind, file, start, end } }
                       validate names, scopes, cursor rules
                                │
                                ▼
          results.ts   QueryResult bound to (project, fixture)
                       every observation is a lazy, memoized field
                                │  first read of an observation
                                ▼
          project.ts   activate(fixture): no-op if active, else swap overlays in the host
                                │
                                ▼
          host.ts      LanguageServiceHost: real files ⊕ project files ⊕ active fixture
                       resolution = TypeScript's own, per import mode
                                │
                                ▼
          service      ts.LanguageService (plugins applied) from typescript.ts
                                │  raw TypeScript response, or an exception
                                ▼
          observations.ts   map to public types; ranges.ts builds every Range from fixture text
                       exceptions → SelenitaError with request, marker, excerpt, cause
                                │
                                ▼
                       deeply frozen plain data, memoized on the result
```

`check` follows the same path for file-wide observations; its named cursors and marks supply locations. Matchers sit entirely outside it: they read observations and format failures from data already captured.

## 2. Modules

| Module | Owns | Never does |
| --- | --- | --- |
| `typescript.ts` | The one import of the backend (`@typescript/typescript6`); the parse cache and version policy (§4) | Anything else. Every other module imports TypeScript from here. |
| `config.ts` | `ProjectConfig` validation; layer merging; tsconfig discovery and parsing; JSON `compilerOptions` conversion; default preferences; aliases → `paths` | Touch the language service |
| `host.ts` | The `LanguageServiceHost`: real files, project files, the active fixture overlay, directory existence for virtual paths, module resolution | Decide which fixture is active |
| `project.ts` | `createProject` and `extend`: lazy service creation, plugin application (and the plugin `info` boundary), fixture activation and observation ownership, derived-project ownership, disposal | Map TypeScript data |
| `markers.ts` | `cursor`, `mark`, `snippet` values, `snippet.join()` composition, `.scope()` scoping, name validation | Know about projects |
| `fixture.ts` | Flattening templates and records into a `Fixture`; marker rules | Talk to TypeScript |
| `results.ts` | `QueryResult`/`CheckResult`: lazy fields, `at`, `rangeOf`, `atEach`, `inspect`, single-cursor guards | Format failures |
| `observations.ts` | Requests with fixture activation and failure context; mapping responses, lazy nested details/fixes | Swallow errors |
| `ranges.ts` | Offset → `Point`, `Range` construction, excerpt rendering, applying text edits | — |
| `errors.ts` | `SelenitaError` with the house prefix and original cause | — |
| `parity.ts` | `compareCompletions` — the parity judgment as data | Format failures |
| `matchers.ts` | Matcher logic and failure messages as runner-free functions | Call the service |
| `vitest.ts` | `defineProject`, `expect.extend`, the `Matchers` augmentation, re-exports | Contain matcher logic |
| `types.ts` | Public types, including marker-name inference | Runtime code |
| `laziness.ts` | Successful-computation caches, lazy accessors, accessor-safe deep freezing | Evaluate unread accessors |
| `index.ts` | The core barrel | — |

Keep each file small enough to read in one sitting. As a prompt, not a limit: when `src/` grows well past ~2,500 lines, look for what has not earned its weight — and also count the machinery a removal would push into users' tests before deciding.

## 3. Invariants

Each invariant protects a user-facing promise from [the vision](../vision.md). A change that breaks one is a contract change, not a refactor.

1. **A result describes its own fixture.** Reading any observation activates the result's fixture first, so an observation is never computed against another fixture's source, files, or resolution context — whatever was read in between.

2. **Fixtures are isolated.** Globals, module augmentations, and file overlays from one fixture never affect another. Project files persist for the project's lifetime; fixture files for one query.

3. **Absence is data; failure is an error.** TypeScript returning nothing becomes `[]` or `null`. TypeScript throwing becomes a `SelenitaError` with `cause`. No `catch` in `observations.ts` returns an empty value.

4. **TypeScript's words are not rewritten.** Displays, messages, kinds, and positions are TypeScript's. The only normalizations are documented in the reference: quote removal in completion names, deterministic ordering of rename locations, diagnostics, and inlay hints, and the `text` rendering of hovers.

5. **Resolution is TypeScript's own.** Each import resolves with its own resolution mode; there is no fallback resolver. Virtual packages follow the same rules as disk packages: an `index.d.ts` can resolve without a manifest, while `package.json` models exports and conditional entries.

6. **Observations are pay-per-read.** Each observation is memoized on first read. Native parent requests may be replayed only when unread details or fixes need to rejoin their observation after another checker has become current. `errors` never computes suggestion diagnostics; `completionNames` never computes details; freezing a value never reads an unread lazy field (such as a diagnostic's `codeFixes`).

7. **Results are evidence.** Returned data is frozen. Methods are non-enumerable so equality and snapshots see only data, and single-cursor fields are enumerable only on single-cursor results. Location-bearing values hold a non-enumerable reference to their fixture, which is how matchers render excerpts without copying source.

8. **Configuration keys and value shapes are validated in every layer at creation; final compiler-option combinations are validated after resolution and merging.** An input-free native TypeScript program checks combinations without reading source files or warming the service. Do not add whole-project file/emit diagnostics to editor observations: anonymous fixtures deliberately live at the project root, including when `rootDir` limits source emission. The whole-project typecheck/build owns those constraints. Preferences are validated against all keys/value shapes of the bundled backend, then forwarded unchanged. Native settings retain their request-specific meanings.

9. **Matchers never call the service.** A failure message formats data that was already observed, so printing a failure can neither fail nor change state.

10. **Read order never changes an observation.** Each top-level observation at each marker, file-wide diagnostics, inlay hints, and each inspection use a checker that has answered nothing else for that fixture. Details and fixes join their parent's checker, replaying the parent on a fresh checker after intervening observations. Field-level activation alone never changes ownership.

11. **The host says what it lacks.** A plugin reaching for host capability selenita does not provide gets a `SelenitaError` naming it — never `undefined` and a confusing crash later.

## 4. Implementation choices

These are how the invariants are met today. Each can change without changing the contract, as long as the evidence for the invariants stays green.

| Choice | Why | Fallback |
| --- | --- | --- |
| One active fixture per project, swapped in on read | Makes laziness correct and isolated with no snapshots of programs | — |
| Re-version active fixture files when observation ownership changes, retaining resolutions within a fixture | A fresh checker makes read order irrelevant without re-parsing the whole project; fixture switches still invalidate resolution for package metadata overlays | Share a checker across markers of the same observation kind only if measured adopter cost requires narrowing the guarantee |
| A process-wide `DocumentRegistry` shared by all projects | Later projects in a worker reuse parsed files | Private registry per project — same behavior, slower second projects |
| Versions that identify content: virtual files take a content identity from one process-wide counter when created; active fixture versions also include the observation generation; real files are versioned by a hash of their content when a host first reads them | The shared registry returns a cached parse for a matching path and version without comparing text, so a version must never stand for two contents. Modification times are not enough: a file can change while its mtime stays equal. | Private registries, if hashing costs too much |
| `resolveModuleNameLiterals` with `getModeForUsageLocation` | TypeScript's own per-import resolution | — |
| Lazy fields as memoizing accessors over closures; values frozen container-by-container | Pay-per-read without a public selection API | — |
| The plugin `info` boundary as an object whose unsupported members throw | Honest failure for plugins that need tsserver (invariant 11). The one place a `Proxy` is acceptable. | — |

## 5. Where to change what

| To… | Change | And update |
| --- | --- | --- |
| Observe something new at a cursor | `observations.ts` (request + mapping), `results.ts` (lazy field), `types.ts` | [api reference](../reference/api.md), the [promises guide](../guide/promises.md) if it serves a promise, a test with a positive and an empty control |
| Add a project option | `config.ts`, `types.ts` | api reference, [projects guide](../guide/projects.md), validation test for a bad value |
| Add or change a matcher | `matchers.ts`, augmentation in `vitest.ts` | [matcher reference](../reference/matchers.md), strict consumer types, failure-output test |
| Change how a fixture is built | `fixture.ts`, `markers.ts` | [fixtures guide](../guide/fixtures.md), marker-rule tests |
| Change resolution or file handling | `host.ts` | a native-TypeScript control proving the expected behavior independently |
| Support another backend | `typescript.ts` first; let real differences, not anticipation, shape any wider seam | [vision §7](../vision.md#7-scope) |
