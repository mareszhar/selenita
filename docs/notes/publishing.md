# Publish Workflow

## Pre-requisites

Make sure you're logged in to npm under the `@mszr` scope:

```sh
npm login --scope=@mszr
```

---

## Steps

### 1. Validate everything locally

```sh
bun run validate
```

This runs lint → typecheck → tests in sequence. All must pass.

### 2. Build and inspect the dist

```sh
bun run build
ls dist/
```

Check that the expected entry points are present (`index.js`, `vitest.js` with their CJS and `.d.ts` counterparts).

### 3. Release

Pick the appropriate bump:

```sh
bun run release:patch   # bug fixes / internal changes — x.y.Z
bun run release:minor   # new features, backward-compatible — x.Y.0
bun run release:major   # breaking changes — X.0.0
```

Each script:

1. Bumps the `version` in `package.json` via `npm version`
2. Publishes to npm with `--access public`

The `prepublishOnly` hook re-runs the full validate + build pipeline before publishing, so publishing with a broken state is not possible.

### 4. Tag and release on GitHub

> **Note:** There is no `CHANGELOG.md` in this repo — this is intentional. The changelog lives exclusively as GitHub release notes (written in step 4). Do not create a `CHANGELOG.md` file.

After publishing, create a GitHub release for the new tag:

```sh
# The npm version command creates a git tag automatically
git push && git push --tags
```

Then go to <https://github.com/mareszhar/selenita/releases/new>, select the new tag, and write the release notes.

Follow the [Keep a Changelog](https://keepachangelog.com/) conventions. Each release entry should list:

- **Added** — new features
- **Changed** — changes to existing behavior
- **Fixed** — bug fixes
- **Removed** — removed features (major-only)
- **Deprecated** — features being phased out
