# selenita documentation

Every fact has one home. Start from what you want to do:

| I want to… | Read |
| --- | --- |
| understand what selenita is for and how it thinks | [Vision](./vision.md) |
| write my first editor test | [Getting started](./guide/getting-started.md) |
| build fixtures: cursors, marks, snippets, several files | [Fixtures](./guide/fixtures.md) |
| test completions, hovers, errors, signature help, rename | [Testing the editor promises](./guide/promises.md) |
| configure projects, plugins, performance, testing kits | [Projects](./guide/projects.md) |
| know exactly what an API or matcher does | [API reference](./reference/api.md) · [Matcher reference](./reference/matchers.md) |
| learn the words selenita uses | [Language](./language.md) |
| change selenita itself | [Architecture](./maintainers/architecture.md) · [Evidence](./maintainers/evidence.md) · [Workflow](./maintainers/workflow.md) |

## How the docs are organized

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
