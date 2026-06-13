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

1. Verifies that you're logged in to npm before doing anything else
2. Runs the full publish checks locally before changing the version
3. Bumps the `version` in `package.json`
4. Publishes to npm with `--access public`
5. Creates the release commit and git tag only after publish succeeds

If authentication or validation fails, the script exits before the version changes. If `npm publish` fails after the local bump, the script restores the version files so a failed publish does not leave behind an accidental extra release commit.

### 4. Tag and release on GitHub

> **Note:** There is no `CHANGELOG.md` in this repo — this is intentional. The changelog lives exclusively as GitHub release notes (written in step 4). Do not create a `CHANGELOG.md` file.

After publishing, push the release commit and tag:

```sh
git push && git push --tags
```

Then go to <https://github.com/mareszhar/selenita/releases/new>, select the new tag, and write the release notes.

Follow the [Keep a Changelog](https://keepachangelog.com/) conventions. Each release entry should list:

- **Added** — new features
- **Changed** — changes to existing behavior
- **Fixed** — bug fixes
- **Removed** — removed features (major-only)
- **Deprecated** — features being phased out
