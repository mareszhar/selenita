# selenita — workflow

How changes to selenita are planned, carried out, reviewed, and released. The method is light on purpose: it exists so any person or agent can pick up work mid-flight and know exactly what is true, what is planned, and what is left.

## 1. Two speeds

Records exist to coordinate and resume work, so use as many as the work needs:

| Change | How it moves |
| --- | --- |
| **Small** — a bug fix, a doc correction, one option, even a small breaking rename | Change, test, and doc update together. A breaking change always gets a changelog entry with its migration. |
| **Initiative** — multi-step work, work spanning sessions or people, or a release-sized redesign | Planned in a handoff, executed against a tracker, reviewed in round reports, announced in a changelog. |

It is an initiative if you would want to resume it tomorrow, or hand it to someone else, without re-reading the whole diff.

## 2. Records

An initiative is named after the version it ships in, without dots: `v030` for 0.3.0.

| Record | Answers | Lives in | Written by |
| --- | --- | --- | --- |
| **handoff** | What does the next release change about the released one, and how do we know it is done? | `__temp__/v030-handoff.md` | planner |
| **tracker** | Where is execution right now, and what is next? | `__temp__/v030-tracker.md` | implementer |
| **round report** | How good is this pass, and what must change before the next? | `__temp__/v030-round-<n>.md` | reviewer |
| **changelog** | What changed for someone using selenita, and how do they migrate? | `__temp__/v030-changelog.md`, then the GitHub release | planner, kept current by the implementer |
| **probes** | What is true about TypeScript, Vitest, or the host, established by running it? | `__temp__/v030-probes/<question>/` | anyone |

Planner, implementer, and reviewer are roles, not people. One person may hold all three; an agent may hold any of them.

## 3. What belongs where

> **A change relative to the released state belongs in the handoff. The state of an execution belongs in the tracker. Feedback on an execution belongs in a round report.**

- The **handoff** is written against the last release, so it reads the same on the first pass and the fifth. It never records progress ("done", "reverted", "currently green"). When execution reveals something new, the handoff gains a plan for it, written as if nobody had started — and the amendment is re-read against every requirement it touches.
- The **tracker** is the implementer's memory and survives a compressed context: files touched, decisions taken, exact commands and their results, blockers, the next action. A pass ends with one row per requirement, each answered by a `file:line` or a gate result.
- A **round report** reviews one pass: what is good, what is wrong, what the evidence proves or fails to prove, and — when the working tree must be reshaped — what survives, what is rewritten, and what is deleted, per file. Reports are never rewritten after the fact; the sequence of them is the history of the initiative.
- The **changelog** speaks the user's vocabulary, not the mechanism's: before/after code for every breaking change, so an agent can migrate a suite mechanically.
- A **probe** is a script or fixture with a comment saying how to run it. No record depends on a probe existing: the handoff states each fact and how to reproduce it.

## 4. Why records are not tracked

`__temp__/` is ignored on purpose. Canonical docs describe how selenita works **now**; a plan describes what is not true yet, and a tracker records attempts. Committing them would put stale claims in every future search.

A fact worth keeping outlives its initiative by moving into a canonical document — the reference, a guide, [architecture](./architecture.md), [evidence](./evidence.md), or this file — rewritten in the present tense. Deleting records is the maintainer's call alone.

## 5. Staging documentation

When an initiative rewrites the docs substantially, the future docs are written in `docs/next/` (tracked) while `docs/` keeps describing the released package. The release swaps them in one step. Small doc changes edit `docs/` directly, in the same commit as the behavior they describe.

## 6. Standing practice

Each rule prevents a failure that a green suite does not report.

- **Establish the domain before prescribing a fix.** State every input a fix must hold over — every caller, every file kind, every resolution mode — before writing it into a plan.
- **Specify the shape, not only the outcome.** When a requirement needs new machinery, the handoff names the expected shape and the shapes it rules out, so the first mechanism that turns a test green is not automatically the accepted one.
- **Prove host behavior before building on it.** A design that rests on what TypeScript, Vitest, or Node does opens with a probe, and states beforehand what happens if the probe fails: a named fallback, or stop and ask.
- **Record facts, not just conclusions.** "Swapping fixtures reproduces observations exactly (probe: `fixture-activation`)" lets the next reader verify; "activation works" does not.
- **Prove each change is load-bearing.** See [evidence §4](./evidence.md#4-proving-a-change-is-load-bearing).
- **Every public capability has a concrete use case** — a realistic test it makes clearer or possible, shown in the docs — and evidence before its slice closes. A caller in a real project is strong evidence, not a prerequisite. Equally, low adoption of an existing capability starts an investigation ([vision §5](../vision.md#5-earning-weight)) rather than a removal.
- **References inform patterns; consumers own their environment.** Extract the promise a reference illustrates into a self-contained fixture with its own source and configuration. Keep an adopter's full-suite migration separate from selenita's required gates. Missing context in an archived reference is a limit on that optional rehearsal; a failure in a required self-contained consumer still needs investigation ([evidence §2](./evidence.md#2-what-a-good-test-contains)).
- **Disclose weak evidence.** Say which leg of an argument is thin; separate what was run from what was only read.
- **Raise environment blocks.** Never substitute a toolchain version or edit a tracked script to suit one machine.
- **Challenge the plan.** An implementer who believes a step is wrong says so before building it. Silent compliance and silent deviation are both failures.

## 7. Working a handoff

For the implementer:

1. Read the handoff completely, then the canonical docs it points to. Do not start from the code.
2. Create or open the tracker. Record the baseline: commit, toolchain versions, gate results before any change.
3. Work slice by slice in the handoff's order. Within a slice: probes first, then tests that fail for the right reason, then the change, then docs.
4. Update the tracker after every meaningful step — it is what lets you, or someone else, resume.
5. Keep the changelog true as you go: every user-visible change gets its before/after the moment it lands.
6. End a pass with the full gate (`bun run verify`) and the per-requirement table in the tracker. Then ask for review.

For the reviewer: read the tracker's table first, then every changed file in full on the first round, then only what changed plus open findings on later rounds. Write `v030-round-<n>.md`.

## 8. Releasing

A version numbers the contract, not the diff. Below 1.0: breaking changes bump the minor (0.3.0), everything else the patch. [Vision §8](../vision.md#8-road-to-10) describes when 1.0 is due.

Publishing and Git are separate acts, both owned by the maintainer. An agent prepares a release; it publishes or touches Git only when asked, and authorization for one is not authorization for the other.

1. `bun run verify` is green on a clean tree, with the pinned toolchain.
2. The changelog is final and every breaking change has a migration example.
3. Run `bun run release:minor` (or `:patch`) in an interactive terminal. The script checks the tree and npm auth, bumps the version, runs `verify` on the bumped version (the build embeds it), and publishes. Publishing inherits the terminal so npm can prompt for browser or two-factor authentication. It never commits, tags, or pushes.
   - If anything fails **before** publishing, it restores the version files and exits.
   - Once publishing succeeds, the bumped files stay: the version exists on npm. The script prints the Git commands that finish the release. When a publish outcome is unclear, check `npm view @mszr/selenita versions` before retrying.
4. The maintainer finishes the release in Git: commit `🔖 release v<version>`, create an annotated tag with `git tag -a v<version> -m 'selenita v<version>'`, then `git push --follow-tags`. Annotated tags are required for `--follow-tags` to include them.
5. Create the GitHub release for the tag, using the changelog as its notes. The GitHub release is the changelog's permanent home; the repository has no `CHANGELOG.md`.
6. Migrate the suites you maintain, using the changelog's migration notes — the first real test of whether they are mechanical.
