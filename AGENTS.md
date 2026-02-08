# Repository Guidelines

## Purpose
This repository is a Bun + TypeScript OpenTUI CLI for pruning Next.js and monorepo build artifacts safely. Optimize for correctness, deletion safety, and fast feedback loops.

## Code Layout
- `src/cli.ts`: CLI entrypoint and non-interactive flows.
- `src/app.tsx` + `src/ui/*`: interactive OpenTUI interface.
- `src/core/*`: scanner, workspace discovery, config parsing, deletion, shared types.
- `tests/unit/*`: core logic tests.
- `tests/integration/*`: CLI behavior tests.
- `tests/tui/*`: OpenTUI rendering/interaction tests.
- `bench/*`: benchmark fixtures, runner, baselines.
- `scripts/pilotty-smoke.sh`: PTY smoke automation.

## Daily Commands
- `bun run dev` — run CLI from source.
- `bun run build` — build distributable CLI into `dist/`.
- `bun test` — run all tests.
- `bun run check` — formatter check + full tests.
- `bun run bench:gate` — CI regression gate.
- `bun run test:pilotty` — end-to-end PTY smoke test (requires `pilotty`, `jq`).

## Non-Negotiable Conventions
- Use `apply_patch` for file edits (clean diffs, predictable tooling).
- In TS files, use `.js` import specifiers (bundler mode). Do not import local `.ts`.
- Reuse shared option types from `src/core/types.ts`; do not duplicate scan option models.
- Canonical workspace discovery modes:
  - `manifest-fallback`
  - `manifest-only`
  - `heuristic-only`
  Legacy literals (`auto`, `manifest`, `heuristic`) belong only in config normalization compatibility.

## Safety Rules
- Non-interactive deletion must stay safe:
  - if `--yes` includes `node_modules` or PM caches, require `--apply`.
- Keep config-default behavior intact when flags are omitted.
- Treat scanner and CLI safety behavior as high-risk surfaces: always add tests with changes.

## Testing Pitfalls To Avoid
- OpenTUI React tests: wrap lifecycle updates in `act(...)` (especially `renderOnce()` and `renderer.destroy()`).
- Pilotty assertions: avoid brittle exact text checks. Prefer:
  - `content_hash` change waits
  - resilient regex checks for key UI states.

## Fast PR Checklist
1. `bunx tsc --noEmit`
2. `bun run check`
3. `bun run bench:gate`
4. (If TUI touched) `bun run test:pilotty`
5. Update README/tests for any flag or behavior change.

## Commits
- Keep commits focused and imperative (e.g., `test: wrap OpenTUI render lifecycle in act`).
- Release format: `Release v<version>: <summary>`.
