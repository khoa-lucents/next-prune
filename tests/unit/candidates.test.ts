import {expect, test} from 'bun:test';
import {
	buildCleanupScopeLabel,
	parseCleanupScope,
	parseScannerCleanupScopes,
	resolveAllowedCandidateTypes,
	resolveCandidateType,
} from '../../src/core/candidates.js';

test('resolveCandidateType classifies cleanup candidates', () => {
	expect(
		resolveCandidateType({
			path: '/repo/node_modules/.cache/next',
			cleanupType: 'artifact',
		}),
	).toBe('node_modules');

	expect(
		resolveCandidateType({
			path: '/repo/.pnpm-store/v3',
			cleanupType: 'pm-cache',
		}),
	).toBe('pm-cache');

	expect(
		resolveCandidateType({
			path: '/repo/public/unused.png',
			type: 'asset',
		}),
	).toBe('asset');

	expect(
		resolveCandidateType({
			path: '/repo/.next',
			cleanupType: 'artifact',
		}),
	).toBe('artifact');
});

test('parseCleanupScope supports aliases and validates unknown values', () => {
	expect([...parseCleanupScope('safe')]).toEqual(['artifact', 'asset']);
	expect([...parseCleanupScope('node-modules,pm-caches')]).toEqual([
		'node_modules',
		'pm-cache',
	]);

	expect(() => parseCleanupScope('not-a-scope')).toThrow(
		'Invalid --cleanup-scope value:',
	);
});

test('resolveAllowedCandidateTypes respects no-node-modules/no-pm-caches switches', () => {
	const safeOnly = resolveAllowedCandidateTypes({
		cleanupScope: 'all',
		includeNodeModules: false,
		includeProjectLocalPmCaches: true,
	});
	expect(safeOnly.has('node_modules')).toBe(false);
	expect(safeOnly.has('pm-cache')).toBe(true);

	const withoutPmCaches = resolveAllowedCandidateTypes({
		cleanupScope: 'all',
		includeNodeModules: true,
		includeProjectLocalPmCaches: false,
	});
	expect(withoutPmCaches.has('node_modules')).toBe(true);
	expect(withoutPmCaches.has('pm-cache')).toBe(false);
});

test('parseScannerCleanupScopes maps all/project/workspace values', () => {
	expect(parseScannerCleanupScopes(undefined)).toBeUndefined();
	expect(parseScannerCleanupScopes('safe')).toBeUndefined();
	expect(parseScannerCleanupScopes('project')).toEqual(['project']);

	const allScopes = parseScannerCleanupScopes('all');
	expect(allScopes?.sort()).toEqual(['project', 'workspace']);
});

test('buildCleanupScopeLabel appends active modifiers', () => {
	expect(
		buildCleanupScopeLabel({
			cleanupScope: 'project,workspace',
			includeNodeModules: true,
			includeProjectLocalPmCaches: true,
		}),
	).toBe('all');

	expect(
		buildCleanupScopeLabel({
			cleanupScope: 'safe',
			includeNodeModules: false,
			includeProjectLocalPmCaches: false,
		}),
	).toBe('safe (no-node-modules,no-pm-caches)');
});
