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
          observe.ts   map to public types; ranges.ts builds every Range from fixture text
                       exceptions → SelenitaError with request, marker, excerpt, cause
                                │
                                ▼
                       deeply frozen plain data, memoized on the result
```

`check` is the same path with no cursors. Matchers sit entirely outside it: they read observations and format failures from data already captured.

## 2. Modules

| Module | Owns | Never does |
| --- | --- | --- |
| `typescript.ts` | The one import of the backend (`@typescript/typescript6`); the process-wide `DocumentRegistry`; the process-wide virtual-file version counter | Anything else. Every other module imports TypeScript from here. |
| `config.ts` | `ProjectConfig` validation; tsconfig discovery and parsing; JSON `compilerOptions` conversion; aliases → `paths` | Touch the language service |
| `host.ts` | The `LanguageServiceHost`: real files, project files, the active fixture overlay, directory existence for virtual paths, module resolution | Decide which fixture is active |
| `project.ts` | `createProject`: lazy service creation, plugin application, fixture activation, disposal | Map TypeScript data |
| `markers.ts` | `cursor`, `mark`, `snippet` values, `.for()` scoping, name validation | Know about projects |
| `fixture.ts` | Flattening templates and records into a `Fixture`; marker rules | Talk to TypeScript |
| `results.ts` | `QueryResult`/`CheckResult`: lazy fields, `at`, `range`, `across`, `raw`, single-cursor guards | Format failures |
| `observe.ts` | One function per TypeScript request, mapping responses to public types | Cache, activate, or swallow errors |
| `ranges.ts` | Offset → `Point`, `Range` construction, excerpt rendering | — |
| `errors.ts` | `SelenitaError` and the message builder for the house error style | — |
| `matchers.ts` | Matcher logic and failure messages as runner-free functions | Call the service |
| `vitest.ts` | `defineProject`, `expect.extend`, the `Matchers` augmentation, re-exports | Contain matcher logic |
| `types.ts` | Public types, including marker-name inference | Runtime code |
| `index.ts` | The core barrel | — |

The source stays small enough that each file can be read in one sitting. Budget: around 2,500 lines of `src/` in total. Crossing ~3,000 is a signal to stop and ask which part has not earned its weight.

## 3. Invariants

Each invariant protects a promise from [the vision](../vision.md). A change that breaks one is a contract change, not a refactor.

1. **One active fixture per project.** The host overlays exactly one fixture at a time. Activation is idempotent; reading any observation activates its fixture first. This is what makes lazy results correct, isolated, and safe under interleaved reads.

2. **Virtual file versions are unique per process.** Fixture and project files get a version from one global counter when they are created, and keep it when re-activated — never per-host counters, never reuse across contents. The shared `DocumentRegistry` hands back a parsed file for a matching path and version without comparing text; a repeated version would give one project another project's parse. Real files are versioned by their modification time when a project first reads them, so a project created after a file changed never sees the old parse.

3. **Absence is data; failure is an error.** TypeScript returning nothing becomes `[]` or `null`. TypeScript throwing becomes a `SelenitaError` with `cause`. No `catch` in `observe.ts` returns an empty value.

4. **TypeScript's words are not rewritten.** Displays, messages, kinds, and positions are TypeScript's. The only normalizations are documented in the reference: quote removal in completion names, deterministic ordering of rename locations and diagnostics, and the `text` rendering of hovers.

5. **Resolution is TypeScript's own.** The host implements `resolveModuleNameLiterals`, passing each import's resolution mode. There is no fallback resolver: a virtual package needs a `package.json`, as a real one does.

6. **Observations are pay-per-read.** Each request runs at most once per result, only when read. `errors` never computes suggestion diagnostics; `completions` never computes details.

7. **Results are evidence.** Returned data is deeply frozen. Methods are non-enumerable so equality and snapshots see only data. Each location-bearing value holds a non-enumerable reference to its fixture, which is how matchers render excerpts without copying source.

8. **Configuration is validated at creation; the program is built on first use.** No option is accepted and ignored.

9. **Matchers never call the service.** A failure message formats data that was already observed, so printing a failure can neither fail nor change state.

## 4. Where to change what

| To… | Change | And update |
| --- | --- | --- |
| Observe something new at a cursor | `observe.ts` (request + mapping), `results.ts` (lazy field), `types.ts` | [api reference](../reference/api.md), the [promises guide](../guide/promises.md) if it serves a promise, a test with a positive and an empty control |
| Add a project option | `config.ts`, `types.ts` | api reference, [projects guide](../guide/projects.md), validation test for a bad value |
| Add or change a matcher | `matchers.ts`, augmentation in `vitest.ts` | [matcher reference](../reference/matchers.md), strict consumer types, failure-output test |
| Change how a fixture is built | `fixture.ts`, `markers.ts` | [fixtures guide](../guide/fixtures.md), marker-rule tests |
| Change resolution or file handling | `host.ts` | a native-TypeScript control proving the expected behavior independently |
| Support another backend | `typescript.ts` first; let real differences, not anticipation, shape any wider seam | [vision §7](../vision.md#7-scope) |
