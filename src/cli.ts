#!/usr/bin/env bun

import process from 'node:process';
import path from 'node:path';
import meow from 'meow';
import {findUnusedAssets} from './core/asset-scanner.js';
import {filterNeverDelete, loadConfig} from './core/config.js';
import {deleteItems, getTotalSize} from './core/delete.js';
import {human, timeAgo} from './core/format.js';
import {getArtifactStats, scanArtifacts} from './core/scanner.js';
import type {
	CleanupScope,
	PruneConfig,
	RuntimeScanOptions,
	ScanItem,
} from './core/types.js';
import {runInteractiveApp} from './index.js';
import type {RuntimeProps} from './index.js';

type CandidateType = 'artifact' | 'asset' | 'node_modules' | 'pm-cache';

type ResolvedScanOptions = RuntimeScanOptions & {
	includeNodeModules: boolean;
	includeProjectLocalPmCaches: boolean;
};

const ALL_CANDIDATE_TYPES: CandidateType[] = [
	'artifact',
	'asset',
	'node_modules',
	'pm-cache',
];
const NODE_MODULES_PATTERN = /(^|\/)node_modules(\/|$)/;
const PM_CACHE_PATTERNS = [
	/(^|\/)\.pnpm-store(\/|$)/,
	/(^|\/)\.pnpm-cache(\/|$)/,
	/(^|\/)\.npm(\/|$)/,
	/(^|\/)\.yarn\/cache(\/|$)/,
	/(^|\/)\.yarn\/unplugged(\/|$)/,
];
const CLEANUP_SCOPE_MAP: Record<string, CandidateType[]> = {
	default: ALL_CANDIDATE_TYPES,
	all: ALL_CANDIDATE_TYPES,
	project: ALL_CANDIDATE_TYPES,
	workspace: ALL_CANDIDATE_TYPES,
	safe: ['artifact', 'asset'],
	artifacts: ['artifact', 'asset'],
	artifact: ['artifact', 'asset'],
	'node-modules': ['node_modules'],
	node_modules: ['node_modules'],
	nodemodules: ['node_modules'],
	'pm-caches': ['pm-cache'],
	pm_caches: ['pm-cache'],
	pmcaches: ['pm-cache'],
};

const cli = meow(
	`
	Usage
	  $ next-prune [options]

	Description
	  Scan for Next.js build artifacts (.next, out), Vercel outputs (.vercel/output),
	  Turborepo caches (.turbo), and other safe-to-delete directories.

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
	  $ next-prune -y --cwd=./packages
	  $ next-prune --yes --cleanup-scope=safe
	  $ next-prune --yes --apply --monorepo
	`,
	{
		importMeta: import.meta,
		flags: {
			yes: {
				type: 'boolean',
				shortFlag: 'y',
				default: false,
			},
			dryRun: {
				type: 'boolean',
				default: false,
			},
			cwd: {
				type: 'string',
			},
			list: {
				type: 'boolean',
				default: false,
			},
			json: {
				type: 'boolean',
				default: false,
			},
			monorepo: {
				type: 'boolean',
				default: false,
			},
			cleanupScope: {
				type: 'string',
			},
			nodeModules: {
				type: 'boolean',
				default: true,
			},
			pmCaches: {
				type: 'boolean',
				default: true,
			},
			workspaceDetect: {
				type: 'boolean',
				default: false,
			},
			maxDepth: {
				type: 'number',
			},
			apply: {
				type: 'boolean',
				default: false,
			},
		},
	},
);

const normalizePathForMatching = (value: string): string =>
	value.split(path.sep).join('/').toLowerCase();

const resolveCandidateType = (
	item: Pick<ScanItem, 'path' | 'type' | 'cleanupType'>,
): CandidateType => {
	if (item.type === 'asset' || item.cleanupType === 'asset') return 'asset';
	if (item.cleanupType === 'pm-cache') return 'pm-cache';
	if (item.cleanupType === 'workspace-node-modules') return 'node_modules';

	const normalizedPath = normalizePathForMatching(item.path);
	if (NODE_MODULES_PATTERN.test(normalizedPath)) return 'node_modules';
	if (PM_CACHE_PATTERNS.some(pattern => pattern.test(normalizedPath))) {
		return 'pm-cache';
	}

	return 'artifact';
};

const parseCleanupScope = (
	cleanupScope: string | undefined,
): Set<CandidateType> => {
	if (!cleanupScope || cleanupScope.trim().length === 0) {
		return new Set(ALL_CANDIDATE_TYPES);
	}

	const resolved = new Set<CandidateType>();
	for (const rawToken of cleanupScope.split(',')) {
		const normalizedToken = rawToken.trim().toLowerCase();
		if (!normalizedToken) continue;
		const mappedTypes = CLEANUP_SCOPE_MAP[normalizedToken];
		if (!mappedTypes) {
			throw new Error(
				`Invalid --cleanup-scope value: "${rawToken}". Expected one or more of: all, project, workspace, safe, node-modules, pm-caches`,
			);
		}
		for (const mappedType of mappedTypes) {
			resolved.add(mappedType);
		}
	}

	if (resolved.size === 0) {
		throw new Error(
			'Invalid --cleanup-scope value: expected one or more valid scope tokens.',
		);
	}

	return resolved;
};

const resolveAllowedCandidateTypes = (
	options: ResolvedScanOptions,
): Set<CandidateType> => {
	const allowed = parseCleanupScope(options.cleanupScope);
	if (!options.includeNodeModules) {
		allowed.delete('node_modules');
	}
	if (!options.includeProjectLocalPmCaches) {
		allowed.delete('pm-cache');
	}
	return allowed;
};

const parseScannerCleanupScopes = (
	cleanupScope: string | undefined,
): CleanupScope[] | undefined => {
	if (!cleanupScope || cleanupScope.trim().length === 0) {
		return undefined;
	}

	const resolved = new Set<CleanupScope>();
	for (const rawToken of cleanupScope.split(',')) {
		const normalizedToken = rawToken.trim().toLowerCase();
		if (!normalizedToken) continue;
		if (normalizedToken === 'all') {
			resolved.add('project');
			resolved.add('workspace');
			continue;
		}
		if (normalizedToken === 'project' || normalizedToken === 'workspace') {
			resolved.add(normalizedToken);
		}
	}

	return resolved.size > 0 ? [...resolved] : undefined;
};

const isApplyProtectedCandidate = (
	item: Pick<ScanItem, 'path' | 'type' | 'cleanupType'>,
): boolean => {
	const candidateType = resolveCandidateType(item);
	return candidateType === 'node_modules' || candidateType === 'pm-cache';
};

const outputListResults = (items: readonly ScanItem[], cwd: string): void => {
	for (const item of items) {
		const rel = path.relative(cwd, item.path) || '.';
		const time = item.mtime ? `(${timeAgo(item.mtime)})` : '';
		const type = item.type === 'asset' ? '⚠️ ' : '';
		const icon = item.isDirectory === false ? '📄' : '📁';
		process.stdout.write(
			`${human(item.size).padStart(6)}  ${time.padEnd(10)} ${type}${icon} ${rel}\n`,
		);
	}

	process.stdout.write(
		`\nTotal: ${human(getTotalSize(items))} in ${items.length} items\n`,
	);
};

const collectItems = async (
	cwd: string,
	config: PruneConfig,
	scanOptions: ResolvedScanOptions,
): Promise<ScanItem[]> => {
	let items = await scanArtifacts(cwd, scanOptions);

	if (config.checkUnusedAssets) {
		const assetPaths = await findUnusedAssets(cwd, {
			skipDirs: scanOptions.skipDirs,
		});
		const assetStats = await Promise.all(
			assetPaths.map(async assetPath => getArtifactStats(assetPath)),
		);
		const assetItems = assetPaths.map((assetPath, index) => ({
			path: assetPath,
			...assetStats[index],
			type: 'asset' as const,
		}));
		items = [...items, ...assetItems];
	}

	items = filterNeverDelete(items, cwd, config.neverDelete);
	const allowedCandidateTypes = resolveAllowedCandidateTypes(scanOptions);
	items = items.filter(item =>
		allowedCandidateTypes.has(resolveCandidateType(item)),
	);
	items.sort((left, right) => right.size - left.size);

	return items;
};

const handleListMode = (
	items: readonly ScanItem[],
	cwd: string,
	asJson: boolean,
): void => {
	if (asJson) {
		process.stdout.write(JSON.stringify(items, null, 2) + '\n');
		return;
	}

	outputListResults(items, cwd);
};

const handleYesMode = async (
	items: readonly ScanItem[],
	dryRun: boolean,
	apply: boolean,
): Promise<void> => {
	if (items.length === 0) {
		process.stdout.write('Nothing to prune.\n');
		return;
	}

	const candidateSize = getTotalSize(items);
	if (dryRun) {
		process.stdout.write(
			`Dry-run: would delete ${items.length} items (${human(candidateSize)}).\n`,
		);
		return;
	}

	const requiresApply = items.some(item => isApplyProtectedCandidate(item));
	if (requiresApply && !apply) {
		process.stderr.write(
			'Refusing to delete node_modules/pm-caches in non-interactive mode without --apply.\n',
		);
		process.stderr.write(
			'Use --apply to proceed, or use --dry-run/--list/--json to preview safely.\n',
		);
		process.exitCode = 1;
		return;
	}

	const summary = await deleteItems(items);
	process.stdout.write(
		`Deleted ${summary.deletedCount}/${items.length} items. Reclaimed ${human(summary.reclaimedBytes)}.\n`,
	);

	if (summary.failureCount > 0) {
		for (const result of summary.results) {
			if (result.ok) continue;
			process.stderr.write(
				`Failed to delete ${result.path}: ${String(result.error)}\n`,
			);
		}
		process.exitCode = 1;
	}
};

const main = async (): Promise<void> => {
	const argv = process.argv.slice(2);
	const cwd = cli.flags.cwd ? path.resolve(cli.flags.cwd) : process.cwd();
	const dryRun = Boolean(cli.flags.dryRun);
	const forceYes = Boolean(cli.flags.yes);
	const apply = Boolean(cli.flags.apply);
	const config = await loadConfig(cwd);
	const maxDepthFlag = cli.flags.maxDepth;
	if (
		typeof maxDepthFlag !== 'undefined' &&
		(typeof maxDepthFlag !== 'number' ||
			!Number.isFinite(maxDepthFlag) ||
			!Number.isInteger(maxDepthFlag) ||
			maxDepthFlag < 0)
	) {
		process.stderr.write('--max-depth must be a non-negative integer.\n');
		process.exitCode = 1;
		return;
	}
	const maxDepth =
		typeof maxDepthFlag === 'number' ? maxDepthFlag : config.maxScanDepth;
	const includeNodeModules = argv.includes('--no-node-modules')
		? false
		: argv.includes('--node-modules')
			? true
			: (config.includeNodeModules ?? true);
	const includeProjectLocalPmCaches = argv.includes('--no-pm-caches')
		? false
		: argv.includes('--pm-caches')
			? true
			: (config.includeProjectLocalPmCaches ?? true);

	const cleanupScopeFromConfig =
		Array.isArray(config.cleanupScopes) && config.cleanupScopes.length > 0
			? config.cleanupScopes.join(',')
			: undefined;
	const cleanupScope =
		typeof cli.flags.cleanupScope === 'string' &&
		cli.flags.cleanupScope.trim().length > 0
			? cli.flags.cleanupScope.trim()
			: cleanupScopeFromConfig;
	const scanOptions: ResolvedScanOptions = {
		monorepoMode: cli.flags.monorepo ? 'on' : config.monorepoMode,
		cleanupScope,
		cleanupScopes: parseScannerCleanupScopes(cleanupScope),
		includeNodeModules,
		includeProjectLocalPmCaches,
		workspaceDiscoveryMode: cli.flags.workspaceDetect
			? 'manifest-fallback'
			: config.workspaceDiscoveryMode,
		maxDepth,
	};

	try {
		resolveAllowedCandidateTypes(scanOptions);
	} catch (error) {
		process.stderr.write(
			`${String(error instanceof Error ? error.message : error)}\n`,
		);
		process.exitCode = 1;
		return;
	}

	const needsScan = forceYes || cli.flags.list || cli.flags.json;
	const scannedItems = needsScan
		? await collectItems(cwd, config, scanOptions)
		: [];

	if (cli.flags.list || cli.flags.json) {
		handleListMode(scannedItems, cwd, Boolean(cli.flags.json));
		return;
	}

	if (forceYes) {
		await handleYesMode(scannedItems, dryRun, apply);
		return;
	}

	const runtimeProps: RuntimeProps = {
		cwd,
		dryRun,
		confirmImmediately: false,
		config,
		scanOptions,
	};

	await runInteractiveApp(runtimeProps);
};

await main();
