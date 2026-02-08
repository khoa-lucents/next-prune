# Agent Guide

## Mission

Build and maintain a **safe, fast, correct** Bun + TypeScript OpenTUI CLI for pruning Next.js and monorepo artifacts.

Primary optimization targets:

1. Deletion safety
2. Behavioral correctness
3. Fast feedback loops

---

## Project Map

- `src/cli.ts` - CLI entrypoint and non-interactive behavior
- `src/app.tsx` + `src/ui/*` - OpenTUI interactive app
- `src/core/*` - scanning, workspace discovery, config, deletion, shared types
- `tests/unit/*` - core logic
- `tests/integration/*` - CLI contract
- `tests/tui/*` - OpenTUI rendering/interaction
- `bench/*` - benchmark runner + fixtures + gate
- `scripts/pilotty-smoke.sh` - PTY smoke flow

---

## Daily Commands

- `bun run dev` - run from source
- `bun run build` - build distributable to `dist/`
- `bun test` - run all tests
- `bun run check` - formatter check + tests
- `bun run bench:gate` - benchmark regression gate
- `bun run test:pilotty` - PTY smoke test (requires `pilotty`, `jq`)

---

## Non-Negotiable Rules

- Use `apply_patch` for edits.
- In TS/TSX, local imports use `.js` specifiers (bundler mode), never local `.ts`.
- Reuse shared option models from `src/core/types.ts`; do not duplicate scan option types.
- Canonical workspace discovery modes are:
  - `manifest-fallback`
  - `manifest-only`
  - `heuristic-only`
- Legacy literals (`auto`, `manifest`, `heuristic`) belong only in config normalization compatibility.

---

## Safety-Critical Constraints

- Non-interactive deletion must remain safe:
  - if `--yes` includes `node_modules` or package-manager caches, require `--apply`.
- Keep config-default behavior unchanged when flags are omitted.
- Treat scanner + CLI safety behavior as high-risk surfaces; pair changes with tests.

---

## OpenTUI Engineering Standards

- Never call `process.exit()` in app flow; use `renderer.destroy()`.
- Keep one predictable keyboard orchestration path at app level.
- Prefer explicit focus zones (`list`, `search`, `confirm`, `help`) over ad hoc key branching.
- Keep layout robust at narrow widths; avoid dense single-line text that becomes unreadable.
- Favor deterministic state transitions (`useReducer` + typed actions) for interaction-heavy UI.

---

## Testing Standards

### General

- Add/adjust tests whenever behavior changes (especially scanner/CLI safety).
- For TUI contract changes, update tests and smoke script in the same PR.

### OpenTUI React Tests

- Wrap render lifecycle operations in `act(...)`, especially:
  - `renderOnce()`
  - `renderer.destroy()`
- Prefer stable-fragment assertions on `captureCharFrame()` output, not brittle full-line text.

### Pilotty Smoke Tests

- Prefer resilient checks:
  - `content_hash` change waits
  - regex checks for key UI states
- Avoid exact frame snapshots for terminal layouts.

---

## Fast-Execution Anti-Friction Notes

- For file removal/refactors, use `apply_patch` (`*** Delete File`) instead of shell `rm`.
- Keyboard event simulation in unit tests can be brittle; use deterministic test seeding (`testMode`, seeded items, controlled props) when possible.
- If interactive keymap or labels change, update all three together:
  - `tests/tui/*`
  - `scripts/pilotty-smoke.sh`
  - `readme.md`
- If `bun run check` fails from unrelated pre-existing formatting, call it out explicitly with scope.

---

## Delivery Checklist

1. `bunx tsc --noEmit`
2. `bun run check`
3. `bun run bench:gate`
4. If TUI changed: `bun run test:pilotty`
5. Update README/tests for behavior or flag changes

---

## Commit Guidance

- Keep commits focused and imperative.
  - Example: `test: make pilotty assertions resilient to TUI layout`
- Release commit format:
  - `Release v<version>: <summary>`
