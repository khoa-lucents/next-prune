# Repository Guidelines

## Project Structure & Module Organization

- Source lives in `source/` (ESM). Entry point is `source/cli.js`; UI is `source/app.js`.
- Build output goes to `dist/` (generated). Do not edit or commit build artifacts.
- Tests live in `test.js` for now; additional tests can follow `*.test.js` naming.
- Key files: `package.json` (scripts/config), `.editorconfig`, `.gitignore`, `.prettierignore`.
- ESM is enabled via `"type": "module"`; include file extensions in relative imports (e.g., `import App from './app.js'`).

Example layout:

```
source/
  cli.js      # CLI entry (compiled to dist/cli.js)
  app.js      # Ink UI (React)
dist/         # Generated on build
test.js       # AVA tests
```

## Build, Test, and Development Commands

- `npm run dev`: Compile `source/` → `dist/` with watch.
- `npm run build`: One-time Babel build to `dist/`.
- `npm test`: Run Prettier check, XO lint, and AVA tests.
- Run the CLI locally after building: `node dist/cli.js --name=Jane` (or `npm link` to use `next-prune`).

## Coding Style & Naming Conventions

- Indentation: tabs (see `.editorconfig`); YAML uses 2 spaces; LF line endings.
- Formatting: Prettier (`@vdemedes/prettier-config`). Format with `npx prettier --write .`.
- Linting: XO with React rules (`xo-react`). Fix with `npx xo --fix`.
- Language: ESM only (`import`/`export`). Keep CLI modules lowercase; use consistent naming for components.

## Testing Guidelines

- Framework: AVA with `import-jsx` loader; UI tested via `ink-testing-library`.
- Location: keep simple tests in root (e.g., `test.js`) or add `*.test.js` files.
- Expectations: cover CLI flags and rendered output frames. Run with `npm test`.

## Commit & Pull Request Guidelines

- Commits: follow Conventional Commits (e.g., `feat(cli): add --dry-run`).
- PRs: include what/why, test steps (commands + expected CLI output), and linked issues.
- Requirements: `npm test` must pass; do not modify `dist/` directly; update docs when behavior changes.

## Security & Configuration Tips

- Node.js >= 16 required. Prefer ESM-compatible deps.
- `.gitignore` excludes `node_modules/` and `dist/`; keep generated files out of PRs.
