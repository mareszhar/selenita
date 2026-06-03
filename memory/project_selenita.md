---
name: project-selenita
description: Architecture, current state, and key decisions for the @mszr/selenita library
metadata:
  type: project
---

# selenita — @mszr/selenita

A TypeScript library for writing IntelliSense tests via a tagged-template API (completions, hover, diagnostics, signature help, inlay hints). Core is runner-agnostic; returns plain objects. Optional `selenita/vitest` adapter extends Vitest's `expect` with custom matchers.

## Status

v0.1.0 — Phase 1–7 complete (see docs/notes/spec.md for roadmap).

## Key architecture decisions

**Vitest-only (as of 2026-06):** Jest support was dropped to reduce maintenance overhead. The library's plain-value return API is still compatible with any test runner, but the only first-class matcher adapter is `selenita/vitest`.

## Entry points

- `@mszr/selenita` — core
- `@mszr/selenita/vitest` — Vitest matcher addon

## Key files

- `src/project.ts` — `defineProject`, `Project` class, lifecycle hooks
- `src/matchers.ts` — shared matcher logic (used by vitest adapter)
- `src/vitest.ts` — Vitest adapter (extends global expect)
- `docs/notes/spec.md` — full specification
- `docs/notes/publishing.md` — release workflow
