# Release Guide — next-prune

This document describes how to cut a new release, publish to npm, and create a GitHub release for next-prune.

## Prerequisites

- Node.js 16+ and npm configured
- Git access to `khoa-lucents/next-prune` with push/tag permissions
- npm publish permission for the `next-prune` package (2FA if enabled)
- GitHub CLI (`gh`) installed and authenticated, or be ready to create releases via web UI

## TL;DR (happy path)

```
# Ensure clean working tree and up-to-date main
git pull

# Run tests locally
npm ci
npm test

# Bump version (choose one: patch | minor | major)
# This creates a commit and a tag automatically
npm version patch -m "Release v%s: <summary>"

# Push commits and tags
git push && git push --tags

# Publish to npm (prepublish runs build + tests)
npm publish --access public

# Create GitHub release with tarball (requires gh)
VERSION=$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version")
mkdir -p artifacts
TGZ=$(npm pack --pack-destination artifacts | tail -1)
# If you need to avoid env-provided token context
env -u GITHUB_TOKEN -u GH_TOKEN gh release create "v$VERSION" "artifacts/$TGZ" \
  --title "v$VERSION" \
  --notes "- <highlights here>"
```

## Step-by-step

1. Validate state

- Ensure you are on `main` and up to date:
  - `git status` should be clean
  - `git pull`
- Install deps and run tests:
  - `npm ci && npm test`
  - CI will also run on push; aim for green before publishing

2. Version bump (SemVer)

- Decide bump type:
  - Patch: bug fixes or internal improvements (x.y.Z)
  - Minor: backward-compatible features (x.Y.z)
  - Major: breaking changes (X.y.z)
- Bump and tag in one step:
  - `npm version patch -m "Release v%s: <summary>"`
  - This updates `package.json`, creates a commit, and creates tag `v<version>`

3. Push

- `git push && git push --tags`

4. Publish to npm

- `npm publish --access public`
- The `prepublishOnly` script runs `npm run build && npm test`. If it fails, fix first.

5. Create a GitHub release

- Pack a tarball and create a release (recommended with `gh`):

```
VERSION=$(node -p "JSON.parse(require('fs').readFileSync('package.json','utf8')).version")
mkdir -p artifacts
TGZ=$(npm pack --pack-destination artifacts | tail -1)
# Unset CI-provided tokens if needed and use your interactive gh auth
env -u GITHUB_TOKEN -u GH_TOKEN gh release create "v$VERSION" "artifacts/$TGZ" \
  --title "v$VERSION" \
  --notes "- TUI: ...\n- Fixes: ...\n- Docs/Repo: ..."
```

- If you prefer the web UI:
  - Go to GitHub → Releases → "Draft a new release"
  - Tag: `v<version>` (use the pushed tag), Title: `v<version>`
  - Paste notes (see template below)
  - Upload `artifacts/next-prune-<version>.tgz`

## Release notes template

```
Highlights
- TUI: <key bindings or UX updates>
- Fixes: <bug fixes>
- Internal: <refactors, tests, repo hygiene>

Changelog
- <bullet of notable changes>
- <bullet of notable changes>
```

## Verification checklist

- npm:
  - `npm info next-prune version` shows the new version
  - `npx next-prune@latest --help` runs successfully
- GitHub:
  - Tag and Release page are visible with correct assets
- Manual sanity check:
  - `npm run build`
  - `node dist/cli.js --cwd=/path/to/nextjs/project --dry-run`
  - Verify keys: Space select, D/Enter confirm, Y delete, N/Esc cancel, R rescan

## Troubleshooting

- GitHub 401 when creating a release via CLI:
  - `gh auth login`
  - Re-run the `env -u GITHUB_TOKEN -u GH_TOKEN gh release create ...` command
- npm publish fails (auth/2FA):
  - `npm whoami`, `npm login`, confirm 2FA device, ensure you have publish rights
- Prettier/XO errors:
  - Run `npm test` locally; address formatting/lint issues before publishing
- Tarball committed by mistake:
  - Tarballs are ignored by `.gitignore`. Use `artifacts/` for local packs (ignored).

## Conventions

- Branch: release from `main`
- Tags: `v<semver>` (e.g., `v1.0.2`)
- Commit message for version bump: `Release v<version>: <summary>`
- Keep notes concise and user-focused
