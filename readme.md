# Next Prune 🧹

> Prune Next.js build artifacts and caches from your terminal. Interactive TUI to scan and delete `.next`, `out`, `.vercel/output`, `.turbo`, and other safe-to-delete directories to free disk space.

[![npm version](https://img.shields.io/npm/v/next-prune.svg)](https://www.npmjs.com/package/next-prune)
[![CI](https://github.com/khoa-lucents/next-prune/actions/workflows/ci.yml/badge.svg)](https://github.com/khoa-lucents/next-prune/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/next-prune.svg)](https://nodejs.org/)

## What Gets Pruned

**Safe to delete (recreated by tools):**

- `.next/` - Next.js build output and cache
- `out/` - Next.js static export output
- `.vercel/output/` - Vercel Build Output API bundle
- `.turbo/` - Turborepo cache (default at `.turbo/cache`)
- `.vercel_build_output/` - Legacy Vercel build output
- `node_modules/.cache/next` - Next.js cache in node_modules

**Always preserved:**

- `.vercel/project.json` - Keeps local folder linked to Vercel project
- `vercel.json` - Vercel project configuration
- `next.config.*` - Next.js configuration
- All source code and project files

**Features:**

- 🎯 Interactive terminal UI built with [Ink](https://github.com/vadimdemedes/ink)
- 🔍 Scans recursively for Next.js, Vercel, and Turborepo build artifacts
- 📊 Shows disk usage for each directory found
- ✅ Select multiple directories for batch deletion
- 🚀 Non-interactive modes for scripting (`--list`, `--json`)
- 🛡️ Safe deletion with confirmation prompts

## Install

```bash
$ npm install --global next-prune
```

## Quick Start

```bash
# Scan and interactively select what to delete
$ npx next-prune

# One-shot cleanup (no prompts)
$ npx next-prune --yes

# Non-interactive listing
$ npx next-prune --list

$ npx next-prune --json
```

## CLI

```text
$ next-prune --help

  Usage
    $ next-prune

  Options
    --yes, -y      Skip confirmation and delete selected immediately
    --dry-run       Don't delete anything; just show results
    --cwd=<path>    Directory to scan (default: current working dir)
    --list          Non-interactive list of artifacts and sizes, then exit
    --json          Output JSON (implies --list)

  Examples
    $ next-prune                # interactive TUI
    $ next-prune --dry-run      # scan only
    $ next-prune --list         # list found artifacts
    $ next-prune --json         # machine-readable output
    $ next-prune --yes          # one-shot cleanup
```

## One-Shot Cleanup

For quick cleanup without interaction:

```bash
# Equivalent to: rm -rf .next out .vercel/output .turbo
$ next-prune --yes
```

## Contributing

See `CONTRIBUTING.md`. By participating, you agree to our `CODE_OF_CONDUCT.md`.

## License

MIT © next-prune contributors
