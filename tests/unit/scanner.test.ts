import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {expect, test} from 'bun:test';
import {getArtifactStats, scanArtifacts} from '../../src/core/scanner.js';

const createTempDirectory = async (): Promise<string> =>
	fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-scan-'));

test('scanArtifacts handles nested custom distDir without skipping sibling projects', async () => {
	const cwd = await createTempDirectory();

	await fs.mkdir(path.join(cwd, 'build/output'), {recursive: true});
	await fs.mkdir(path.join(cwd, 'build/nested-app/.next'), {recursive: true});
	await fs.writeFile(
		path.join(cwd, 'next.config.js'),
		"module.exports = { distDir: 'build/output' };\n",
	);

	const items = await scanArtifacts(cwd);
	const relativePaths = items
		.map(item => path.relative(cwd, item.path))
		.sort((left, right) => left.localeCompare(right));

	expect(relativePaths).toEqual([
		path.join('build', 'nested-app', '.next'),
		path.join('build', 'output'),
	]);
});

test('scanArtifacts discovers custom distDir with leading ./ and trailing slash', async () => {
	const cwd = await createTempDirectory();

	await fs.mkdir(path.join(cwd, 'dist-output'), {recursive: true});
	await fs.writeFile(
		path.join(cwd, 'next.config.ts'),
		"export default { distDir: './dist-output/' };\n",
	);

	const items = await scanArtifacts(cwd);
	expect(items.map(item => path.relative(cwd, item.path))).toEqual([
		'dist-output',
	]);
});

test('getArtifactStats returns stable zeroed stats for missing path', async () => {
	const target = path.join(await createTempDirectory(), 'missing');
	const stats = await getArtifactStats(target);

	expect(stats.size).toBe(0);
	expect(stats.fileCount).toBe(0);
	expect(stats.isDirectory).toBe(false);
	expect(stats.mtime.getTime()).toBe(0);
	expect(Boolean(stats.error)).toBe(true);
});

test('scanArtifacts includes workspace node_modules candidates only in workspace scope', async () => {
	const cwd = await createTempDirectory();
	const workspaceDir = path.join(cwd, 'packages/web');

	await fs.mkdir(path.join(workspaceDir, 'node_modules/.cache/next'), {
		recursive: true,
	});
	await fs.writeFile(
		path.join(cwd, 'package.json'),
		JSON.stringify({
			name: 'root',
			private: true,
			workspaces: ['packages/*'],
		}),
	);
	await fs.writeFile(
		path.join(workspaceDir, 'package.json'),
		JSON.stringify({name: 'web'}),
	);

	const scopedItems = await scanArtifacts(cwd, {cleanupScopes: ['workspace']});
	const scopedRelativePaths = new Set(
		scopedItems.map(item => path.relative(cwd, item.path)),
	);
	expect(
		scopedRelativePaths.has(path.join('packages', 'web', 'node_modules')),
	).toBe(true);
	expect(
		scopedRelativePaths.has(
			path.join('packages', 'web', 'node_modules', '.cache', 'next'),
		),
	).toBe(true);

	const projectOnlyItems = await scanArtifacts(cwd, {
		cleanupScopes: ['project'],
	});
	const projectOnlyRelativePaths = new Set(
		projectOnlyItems.map(item => path.relative(cwd, item.path)),
	);
	expect(
		projectOnlyRelativePaths.has(path.join('packages', 'web', 'node_modules')),
	).toBe(false);
});

test('scanArtifacts uses heuristic workspace discovery fallback when manifest is missing', async () => {
	const cwd = await createTempDirectory();
	const workspaceDir = path.join(cwd, 'apps/site');

	await fs.mkdir(path.join(workspaceDir, '.next'), {recursive: true});
	await fs.writeFile(
		path.join(cwd, 'package.json'),
		JSON.stringify({name: 'root', private: true}),
	);
	await fs.writeFile(
		path.join(workspaceDir, 'package.json'),
		JSON.stringify({name: 'site'}),
	);

	const items = await scanArtifacts(cwd, {
		cleanupScopes: ['workspace'],
		monorepoMode: 'on',
		workspaceDiscoveryMode: 'manifest-fallback',
	});
	const relativePaths = items.map(item => path.relative(cwd, item.path));

	expect(relativePaths).toEqual([path.join('apps', 'site', '.next')]);
	expect(items[0]?.cleanupScope).toBe('workspace');
});

test('scanArtifacts discovers pnpm workspace directories in manifest-only mode', async () => {
	const cwd = await createTempDirectory();
	const siteDir = path.join(cwd, 'apps/site');
	const ignoredDir = path.join(cwd, 'apps/ignored');

	await fs.mkdir(path.join(siteDir, '.next'), {recursive: true});
	await fs.mkdir(path.join(ignoredDir, '.next'), {recursive: true});
	await fs.writeFile(
		path.join(cwd, 'package.json'),
		JSON.stringify({name: 'repo', private: true}),
	);
	await fs.writeFile(
		path.join(siteDir, 'package.json'),
		JSON.stringify({name: 'site'}),
	);
	await fs.writeFile(
		path.join(ignoredDir, 'package.json'),
		JSON.stringify({name: 'ignored'}),
	);
	await fs.writeFile(
		path.join(cwd, 'pnpm-workspace.yaml'),
		['packages:', '  - "apps/*"', '  - "!apps/ignored"'].join('\n'),
	);

	const items = await scanArtifacts(cwd, {
		cleanupScopes: ['workspace'],
		monorepoMode: 'on',
		workspaceDiscoveryMode: 'manifest-only',
	});
	const relativePaths = items.map(item => path.relative(cwd, item.path));

	expect(relativePaths).toEqual([path.join('apps', 'site', '.next')]);
});

test('scanArtifacts discovers lerna workspace directories in manifest-only mode', async () => {
	const cwd = await createTempDirectory();
	const workspaceDir = path.join(cwd, 'packages/web');

	await fs.mkdir(path.join(workspaceDir, '.next'), {recursive: true});
	await fs.writeFile(
		path.join(cwd, 'package.json'),
		JSON.stringify({name: 'repo', private: true}),
	);
	await fs.writeFile(
		path.join(cwd, 'lerna.json'),
		JSON.stringify({packages: ['packages/*']}),
	);
	await fs.writeFile(
		path.join(workspaceDir, 'package.json'),
		JSON.stringify({name: 'web'}),
	);

	const items = await scanArtifacts(cwd, {
		cleanupScopes: ['workspace'],
		monorepoMode: 'on',
		workspaceDiscoveryMode: 'manifest-only',
	});
	const relativePaths = items.map(item => path.relative(cwd, item.path));

	expect(relativePaths).toEqual([path.join('packages', 'web', '.next')]);
});

test('scanArtifacts discovers project-local package manager caches', async () => {
	const cwd = await createTempDirectory();

	await fs.mkdir(path.join(cwd, '.pnpm-store/v3'), {recursive: true});
	await fs.mkdir(path.join(cwd, '.yarn/cache'), {recursive: true});

	const items = await scanArtifacts(cwd, {cleanupScopes: ['project']});
	const itemByRelativePath = new Map(
		items.map(item => [path.relative(cwd, item.path), item]),
	);

	expect(itemByRelativePath.has('.pnpm-store')).toBe(true);
	expect(itemByRelativePath.has(path.join('.yarn', 'cache'))).toBe(true);
	expect(itemByRelativePath.get('.pnpm-store')?.cleanupType).toBe('pm-cache');
	expect(itemByRelativePath.get(path.join('.yarn', 'cache'))?.cleanupType).toBe(
		'pm-cache',
	);
});

test('scanArtifacts ignores candidates that resolve outside root via symlink', async () => {
	const cwd = await createTempDirectory();
	const outsideRoot = await createTempDirectory();

	await fs.mkdir(path.join(outsideRoot, 'dist-output'), {recursive: true});
	await fs.symlink(
		path.join(outsideRoot, 'dist-output'),
		path.join(cwd, 'dist-link'),
	);
	await fs.writeFile(
		path.join(cwd, 'next.config.js'),
		"module.exports = { distDir: 'dist-link' };\n",
	);

	const items = await scanArtifacts(cwd);
	const relativePaths = new Set(
		items.map(item => path.relative(cwd, item.path)),
	);

	expect(relativePaths.has('dist-link')).toBe(false);
});
