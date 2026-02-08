# Next Prune 🧹

> Prune Next.js build artifacts and caches from your terminal. Interactive Clack prompts to scan and delete `.next`, `out`, `.vercel/output`, `.turbo`, workspace `node_modules`, and package-manager caches to free disk space.

[![npm version](https://img.shields.io/npm/v/next-prune.svg)](https://www.npmjs.com/package/next-prune)
[![CI](https://github.com/khoa-lucents/next-prune/actions/workflows/ci.yml/badge.svg)](https://github.com/khoa-lucents/next-prune/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Bun Version](https://img.shields.io/badge/bun-%3E%3D1.3.0-f9f1e1)](https://bun.sh/)

## What Gets Pruned

**Safe to delete (recreated by tools):**

- `.next/` - Next.js build output and cache
- `distDir` output configured in `next.config.*` (for example `build/` or `dist/`)
- `out/` - Next.js static export output
- `.vercel/output/` - Vercel Build Output API bundle
- `.turbo/` - Turborepo cache (default at `.turbo/cache`)
- `.vercel_build_output/` - Legacy Vercel build output
- `node_modules/.cache/next` and `node_modules/.cache/turbopack`
- Workspace `node_modules/` directories (when workspace cleanup is enabled)
- Package-manager caches (`.npm`, `.pnpm-store`, `.yarn/cache`, `.yarn/unplugged`, `.bun/install/cache`)

**Always preserved:**

- `.vercel/project.json` - Keeps local folder linked to Vercel project
- `vercel.json` - Vercel project configuration
- `next.config.*` - Next.js configuration
- All source code and project files

**Features:**

- 🎯 **New:** Clack-powered interactive workflow
- 🔍 Scans recursively for Next.js, Vercel, and Turborepo build artifacts
- 🧭 Detects custom Next.js build output via `distDir` in `next.config.*` (including Next.js 16 projects)
- 📊 Shows disk usage for each directory found
- ⇅ Sort candidates by size, age, or path before selection
- 🧾 Interactive multi-select with candidate metadata hints
- ✅ Select multiple directories for batch deletion
- 🚀 Non-interactive modes for scripting (`--list`, `--json`)
- 🧱 Monorepo/workspace cleanup controls (`--monorepo`, `--cleanup-scope`, `--workspace-detect`)
- 🛡️ Safe deletion with confirmation prompts

## Install

```bash
$ bun add --global next-prune
```

## Quick Start

```bash
# Scan and interactively select what to delete
$ bunx next-prune

# One-shot cleanup of safe artifacts only (no --apply needed)
$ bunx next-prune --yes --cleanup-scope=safe

# Non-interactive listing
$ bunx next-prune --list

$ bunx next-prune --json

# Include node_modules / PM caches in non-interactive cleanup
$ bunx next-prune --yes --apply

# Workspace-only scan in a monorepo
$ bunx next-prune --json --cleanup-scope=workspace --monorepo
```

## CLI

```text
$ next-prune --help

  Usage
    $ next-prune

  Options
    --yes, -y     Skip confirmation and delete selected immediately
    --dry-run     Don't delete anything; just show results
    --cwd=<path>  Directory to scan (default: current working dir)
    --list        Non-interactive list of artifacts and sizes, then exit
    --json        Output JSON (implies --list)
    --monorepo    Scan as a monorepo/workspace root
    --cleanup-scope=<scope>
                  Cleanup scope (e.g. all, safe, node-modules, pm-caches)
    --no-node-modules
                  Exclude node_modules candidates
    --no-pm-caches
                  Exclude package-manager cache candidates
    --workspace-detect
                  Enable workspace auto-detection
    --max-depth=<n>
                  Maximum scan depth
    --apply       Required with --yes to delete node_modules/pm-caches

  Examples
    $ next-prune
    $ next-prune --dry-run
    $ next-prune --list --cleanup-scope=safe
    $ next-prune --json --cleanup-scope=workspace --monorepo
    $ next-prune --yes --cleanup-scope=safe
    $ next-prune --yes --apply --cleanup-scope=node-modules,pm-caches
```

## One-Shot Cleanup

For quick cleanup without interaction:

```bash
# Safe artifacts only (won't touch node_modules or PM caches)
$ next-prune --yes --cleanup-scope=safe

# Include node_modules / PM caches (explicit opt-in required)
$ next-prune --yes --apply
```

`--yes` without `--apply` will refuse deletion if the selected candidates include
`node_modules` or package-manager caches.

## Pilotty Smoke Test

If you have [`pilotty`](https://github.com/msmps/pilotty) installed, run the
end-to-end TUI smoke test:

```bash
bun run test:pilotty
```

What it validates:

- Clack interactive flow launches in a real PTY session
- sort prompt and candidate multiselect render correctly
- confirmation and deletion prompts execute in sequence
- confirmed deletion actually removes an artifact directory

## Contributing

See `CONTRIBUTING.md`. By participating, you agree to our `CODE_OF_CONDUCT.md`.

## License

MIT © next-prune contributors
