#!/usr/bin/env bun

import process from 'node:process';
import path from 'node:path';
import meow from 'meow';
import {findUnusedAssets} from './core/asset-scanner.js';
import {
	isApplyProtectedCandidate,
	parseScannerCleanupScopes,
	resolveAllowedCandidateTypes,
	resolveCandidateType,
} from './core/candidates.js';
import {filterNeverDelete, loadConfig} from './core/config.js';
import {deleteItems, getTotalSize} from './core/delete.js';
import {human, timeAgo} from './core/format.js';
import {getArtifactStats, scanArtifacts} from './core/scanner.js';
import type {PruneConfig, RuntimeScanOptions, ScanItem} from './core/types.js';
import {runInteractiveApp} from './index.js';
import type {RuntimeProps} from './index.js';

type ResolvedScanOptions = RuntimeScanOptions & {
	includeNodeModules: boolean;
	includeProjectLocalPmCaches: boolean;
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
	  --cold-storage
	                  Aggressive slim mode for archival/cold-storage cleanup
	  --monorepo    Scan as a monorepo/workspace root
	  --cleanup-scope=<scope>
	                  Cleanup scope (e.g. all, cold-storage, safe, node-modules, pm-caches)
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
	  $ next-prune --yes --apply --cold-storage
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
			coldStorage: {
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
	const coldStorage = Boolean(cli.flags.coldStorage);
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
			: coldStorage
				? true
				: (config.includeNodeModules ?? true);
	const includeProjectLocalPmCaches = argv.includes('--no-pm-caches')
		? false
		: argv.includes('--pm-caches')
			? true
			: coldStorage
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
			: coldStorage
				? 'cold-storage'
				: cleanupScopeFromConfig;
	const scanOptions: ResolvedScanOptions = {
		monorepoMode:
			cli.flags.monorepo || coldStorage ? 'on' : config.monorepoMode,
		cleanupScope,
		cleanupScopes: parseScannerCleanupScopes(cleanupScope),
		includeNodeModules,
		includeProjectLocalPmCaches,
		workspaceDiscoveryMode:
			cli.flags.workspaceDetect || coldStorage
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

	let scannedItems: ScanItem[] = [];
	try {
		scannedItems = await collectItems(cwd, config, scanOptions);
	} catch (error) {
		process.stderr.write(
			`Scan failed: ${String(error instanceof Error ? error.message : error)}\n`,
		);
		process.exitCode = 1;
		return;
	}

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
		config,
		scanOptions,
		items: scannedItems,
	};

	await runInteractiveApp(runtimeProps);
};

await main();
