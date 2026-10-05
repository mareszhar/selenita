# selenita documentation

Two short documents set the ground for everything else. The rest is organized by what you are trying to do.

## Start here

| Read | To learn |
| --- | --- |
| [Vision](./vision.md) | why selenita exists, the model it is built on, and the principles every change answers to |
| [Language](./language.md) | the vocabulary, naming rules, and writing style: one word per idea, everywhere |

Want to write a test right now? [Getting started](./guide/getting-started.md) takes a few minutes.

## By task

| I want to… | Read |
| --- | --- |
| write my first editor test | [Getting started](./guide/getting-started.md) |
| build fixtures: cursors, marks, snippets, several files | [Fixtures](./guide/fixtures.md) |
| test completions, hovers, errors, signature help, inlay hints, rename | [Testing the editor promises](./guide/promises.md) |
| configure projects, plugins, performance, testing kits | [Projects](./guide/projects.md) |
| know exactly what an API or matcher does | [API reference](./reference/api.md) · [Matcher reference](./reference/matchers.md) |
| change selenita itself | [Architecture](./maintainers/architecture.md) · [Evidence](./maintainers/evidence.md) · [Workflow](./maintainers/workflow.md) |

## How the docs are organized

Every fact has one home.

```text
docs/
├── vision.md          why selenita exists · the model · principles · scope    (everyone)
├── language.md        vocabulary · naming rules · error and writing style     (everyone)
├── guide/             how to do things, by task                               (users)
├── reference/         exact contracts                                         (users)
└── maintainers/       how selenita is built, proven, and released             (maintainers)
```

- **Guides** teach by task and link to the reference for precise behavior.
- **The reference** states the shipped contract in the present tense. When it and a guide disagree, the reference wins and the guide is the bug.
- **Vision and language** are shared ground: they govern the API, the docs, and the code alike.
- **Plans, progress, and history** never live here. They live in ignored initiative records and, once released, in GitHub release notes — see [workflow](./maintainers/workflow.md).
