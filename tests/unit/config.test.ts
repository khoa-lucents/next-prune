import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {expect, test} from 'bun:test';
import {
	DEFAULT_CONFIG,
	filterNeverDelete,
	loadConfig,
	matchesConfigPattern,
	normalizeConfigPattern,
	normalizeCleanupScopes,
	normalizeRelativePath,
	selectAlwaysDeletePaths,
} from '../../src/core/config.js';

const createTempDirectory = async (): Promise<string> =>
	fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-config-'));

test('normalizeConfigPattern trims separators and trailing slash', () => {
	expect(normalizeConfigPattern('./.next/')).toBe('.next');
	expect(normalizeConfigPattern('.\\node_modules\\.cache\\')).toBe(
		'node_modules/.cache',
	);
	expect(normalizeConfigPattern('  ./app/build///  ')).toBe('app/build');
	expect(normalizeConfigPattern('../outside')).toBeNull();
	expect(normalizeConfigPattern('/absolute/path')).toBe('absolute/path');
});

test('normalizeRelativePath normalizes separators and dot prefixes', () => {
	expect(normalizeRelativePath('./app/.next/')).toBe('app/.next');
	expect(normalizeRelativePath('app\\build\\output')).toBe('app/build/output');
	expect(normalizeRelativePath('.')).toBe('');
});

test('matchesConfigPattern handles normalized prefix matching', () => {
	expect(matchesConfigPattern('app/.next', './app/.next/')).toBe(true);
	expect(
		matchesConfigPattern(
			'node_modules\\.cache\\next',
			'./node_modules/.cache/',
		),
	).toBe(true);
	expect(matchesConfigPattern('apps/site/.next', './app/')).toBe(false);
});

test('loadConfig merges package and rc and normalizes arrays', async () => {
	const cwd = await createTempDirectory();

	await fs.writeFile(
		path.join(cwd, 'package.json'),
		JSON.stringify({
			name: 'fixture',
			'next-prune': {
				alwaysDelete: ['./.next/', './build/'],
				neverDelete: ['.\\node_modules\\.cache\\'],
				checkUnusedAssets: false,
				monorepoMode: 'on',
				workspaceDiscoveryMode: 'manifest',
				cleanupScopes: ['workspace', 'invalid-scope'],
			},
		}),
	);

	await fs.writeFile(
		path.join(cwd, '.next-prunerc.json'),
		JSON.stringify({
			alwaysDelete: ['./out/'],
			neverDelete: ['./public/assets/'],
			checkUnusedAssets: true,
			workspaceDiscoveryMode: 'heuristic',
			cleanupScopes: ['workspace'],
		}),
	);

	const config = await loadConfig(cwd);
	expect(config).toEqual({
		alwaysDelete: ['out'],
		neverDelete: ['public/assets'],
		checkUnusedAssets: true,
		monorepoMode: 'on',
		workspaceDiscoveryMode: 'heuristic-only',
		cleanupScopes: ['workspace'],
		includeNodeModules: true,
		includeProjectLocalPmCaches: true,
		maxScanDepth: undefined,
	});
});

test('loadConfig applies monorepo and workspace defaults when unset', async () => {
	const cwd = await createTempDirectory();
	await fs.writeFile(
		path.join(cwd, 'package.json'),
		JSON.stringify({name: 'fixture'}),
	);

	const config = await loadConfig(cwd);
	expect(config).toEqual(DEFAULT_CONFIG);
});

test('normalizeCleanupScopes keeps valid values and supports explicit empty array', () => {
	expect(
		normalizeCleanupScopes(['workspace', 'project', 'workspace', 'invalid']),
	).toEqual(['workspace', 'project']);
	expect(normalizeCleanupScopes([], ['project', 'workspace'])).toEqual([]);
	expect(normalizeCleanupScopes(undefined, ['project'])).toEqual(['project']);
});

test('filterNeverDelete and selectAlwaysDeletePaths share path semantics', () => {
	const cwd = '/repo';
	const items = [
		{path: '/repo/.next', size: 1},
		{path: '/repo/node_modules/.cache/next', size: 1},
		{path: '/repo/out', size: 1},
	];

	const filtered = filterNeverDelete(items, cwd, [
		'.\\node_modules\\.cache\\',
		'./out/',
	]);
	expect(filtered.map(item => path.relative(cwd, item.path))).toEqual([
		'.next',
	]);

	const selected = selectAlwaysDeletePaths(items, cwd, [
		'./.next/',
		'.\\node_modules\\.cache',
	]);
	expect(
		[...selected].map(itemPath => path.relative(cwd, itemPath)).sort(),
	).toEqual(['.next', path.join('node_modules', '.cache', 'next')].sort());
});
