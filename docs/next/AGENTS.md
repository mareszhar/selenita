# Working on selenita

selenita (`@mszr/selenita`) lets people test their TypeScript API's editor experience — completions, hovers, diagnostics, signature help, rename — with tagged-template fixtures and plain observations. Its guiding question for every decision: **what would feel most delightful to use?**

## Read first

1. [`docs/vision.md`](./docs/vision.md) — the model, principles, and how additions earn their weight.
2. [`docs/language.md`](./docs/language.md) — the vocabulary; use these words exactly.
3. For changes to `src/`: [`docs/maintainers/architecture.md`](./docs/maintainers/architecture.md) and its invariants.
4. For any initiative: [`docs/maintainers/workflow.md`](./docs/maintainers/workflow.md). The current plan, if any, is the newest `__temp__/v*-handoff.md`; its progress is the matching tracker.

## Commands

| Command | Does |
| --- | --- |
| `bun install --frozen-lockfile` | Install with the pinned toolchain |
| `bun run validate` | Lint, typecheck, tests |
| `bun run verify` | `validate` plus build, strict consumer types, and the packed-package gate — run before asking for review or releasing |

## Rules that are easy to miss

- The reference docs are the contract. Change behavior and its doc in the same change.
- Every promise gets a test with a positive control beside each negative one ([evidence](./docs/maintainers/evidence.md)).
- TypeScript is imported only through `src/typescript.ts`.
- Plans and progress live in ignored `__temp__/` records, never in tracked docs. Never delete anything in `__temp__/` or `__references__/`.
- Don't commit, tag, push, or publish unless explicitly asked.
