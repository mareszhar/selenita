# selenita — evidence

selenita sells evidence, so its own evidence has to be beyond reproach. This document says what earns a test, what a good test contains, and which gates must be green before a release.

## 1. What earns a persisted test

A persisted test is evidence for a promise selenita makes to the people using it. Before keeping one, ask what a red result would mean:

- **A promise broke** (a matcher accepted a leak, an observation lied, a fixture leaked into another) → keep it.
- **Someone made a different, equally valid choice** (renamed an internal, reordered a file) → it is a change detector. Delete it.

Do not persist a test whose subject is the repository (a file exists, a word is absent), another test, or a reminder. Do not persist a test that restates the implementation branch by branch, stubs the thing under test, or cannot fail unless another test also fails. Those checks are fine as one-off probes: run them, read them, discard them.

## 2. What a good test contains

**Both sides of a promise.** A guard is proven when it fires on the violation and stays silent on the adjacent non-violation. A negative assertion sits next to a positive control:

```ts
it('reports service failures instead of empty completions', () => {
  using project = createProject({ tsconfig: false, plugins: [throwingCompletions] })
  const result = project.query`const fruit = { apple: 1 }; fruit.${cursor}`
  expect(() => result.completions).toThrow(/could not collect completions/)
})

it('keeps a genuine absence empty', () => {
  using project = createProject({ tsconfig: false })
  const result = project.query`
    const fruit = { apple: 1 }
    // inside a comment ${cursor}
  `
  expect(result.completions).toEqual([]) // the editor offers nothing here
  expect(result.hover).toBeNull()
})
```

The plugin seam doubles as failure injection: a plugin whose `getCompletionsAtPosition` throws is all the first test needs.

**Expectations derived independently.** Expected values come from TypeScript itself (a native language-service call in the test), from the fixture text, or from a literal — never from the selenita code path under test. A test that compares an observation with another value derived from the same observation proves nothing.

**Recovery where the contract promises it.** After a failure, the next query on the same project works. After disposal, values already read remain.

**The real environment.** Tests run against the backend selenita ships. A fixture that disables a default (symlinked packages, `skipLibCheck`) proves nothing about the default; the default gets its own evidence.

## 3. Gates

| Gate | Proves | Command |
| --- | --- | --- |
| Lint | Code and doc examples follow house style | `bun run lint` |
| Typecheck | Source types, including marker-name inference cases with `@ts-expect-error` | `bun run typecheck` |
| Core tests | Fixtures, observations, laziness and activation, failures, lifecycle, plugins, resolution, matchers and their failure output | `bun run test` |
| Self-DX | selenita's own editor experience, tested with selenita: marker names autocomplete in `at()`, options are documented, matchers have docs | part of `bun run test` (`tests/selenita.dx.test.ts`) |
| Strict consumer | The built declarations compile with `skipLibCheck: false` under Vitest 5, including async and asymmetric matcher forms | `bun run test:types` |
| Package | A packed tarball installs into a fresh consumer that has **TypeScript 7** and Vitest 5 (and no TypeScript 6 of its own), runs a real Vitest file with `defineProject` and every matcher, imports the core from ESM and `require()` | `bun run test:package` |

`bun run validate` runs the first four; `bun run verify` runs all of them. A release runs `verify`.

A gate that cannot run in the pinned environment is an environment problem to raise, not to route around. Never swap in another toolchain version or edit a tracked script to suit one machine.

## 4. Proving a change is load-bearing

For every behavioral fix, before calling it done: revert the fix alone, confirm a named test turns red, restore it. A change that cannot be made to fail is untested, unnecessary, or a defensive invariant — the last kind stays in code with a comment naming the condition it guards, and gets no artificial test.

This is a review practice, not a persisted meta-test.

## 5. Performance evidence

Performance claims need numbers from `scripts/bench.ts`: a small synthetic project and one realistic one, cold and warm, reporting program build time, per-observation time, and the effect of the shared document registry. Record toolchain versions, hardware, and repetitions with the numbers. A change to activation, laziness, or the registry includes a before/after run in its review.

## 6. Documentation evidence

Docs are linted with the code, so examples follow house style. Examples that state exact behavior (an observation's value, a failure message) are mirrored by a test, so a doc cannot keep describing behavior the package no longer has.
