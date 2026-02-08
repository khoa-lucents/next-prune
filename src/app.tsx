/** @jsxImportSource @opentui/react */

import path from 'node:path';
import process from 'node:process';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {useKeyboard, useRenderer, useTerminalDimensions} from '@opentui/react';
import {findUnusedAssets} from './core/asset-scanner.js';
import {
	DEFAULT_CONFIG,
	filterNeverDelete,
	selectAlwaysDeletePaths,
} from './core/config.js';
import {deleteItems} from './core/delete.js';
import {human} from './core/format.js';
import {getArtifactStats, scanArtifacts} from './core/scanner.js';
import type {
	CleanupScope,
	PruneConfig,
	RuntimeScanOptions,
	ScannerOptions,
	ScanItem,
} from './core/types.js';
import {ArtifactList} from './ui/artifact-list.js';
import {ConfirmModal} from './ui/confirm-modal.js';
import {Dashboard} from './ui/dashboard.js';
import {Footer} from './ui/footer.js';
import {Header} from './ui/header.js';
import type {
	ArtifactItem,
	ArtifactStatus,
	CandidateType,
	ShortcutHint,
	SortMode,
} from './ui/types.js';

interface AppProps {
	cwd?: string;
	dryRun?: boolean;
	confirmImmediately?: boolean;
	testMode?: boolean;
	config?: Partial<PruneConfig>;
	scanOptions?: RuntimeScanOptions;
}

type ScannerItem = ScanItem & {status?: ArtifactStatus};

type StatusState = {
	message: string;
	kind: 'error' | 'success' | 'info';
} | null;

type ResolvedScanOptions = {
	cleanupScope?: string;
	scannerOptions: ScannerOptions;
};

const SORT_MODES: SortMode[] = ['size', 'age', 'path'];
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

const clampIndex = (nextIndex: number, totalItems: number) => {
	if (totalItems <= 0) return 0;
	return Math.max(0, Math.min(totalItems - 1, nextIndex));
};

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

const resolveScanOptions = (
	options: RuntimeScanOptions | undefined,
	config: PruneConfig,
): ResolvedScanOptions => {
	const cleanupScopeFromConfig =
		Array.isArray(config.cleanupScopes) && config.cleanupScopes.length > 0
			? config.cleanupScopes.join(',')
			: undefined;
	const cleanupScope =
		typeof options?.cleanupScope === 'string' &&
		options.cleanupScope.trim().length > 0
			? options.cleanupScope.trim()
			: cleanupScopeFromConfig;
	const configMaxDepth =
		typeof config.maxScanDepth === 'number' &&
		Number.isFinite(config.maxScanDepth) &&
		config.maxScanDepth >= 0
			? Math.floor(config.maxScanDepth)
			: undefined;
	const optionMaxDepth =
		typeof options?.maxDepth === 'number' &&
		Number.isFinite(options.maxDepth) &&
		options.maxDepth >= 0
			? Math.floor(options.maxDepth)
			: undefined;

	return {
		cleanupScope,
		scannerOptions: {
			skipDirs: options?.skipDirs,
			monorepoMode: options?.monorepoMode ?? config.monorepoMode,
			workspaceDiscoveryMode:
				options?.workspaceDiscoveryMode ?? config.workspaceDiscoveryMode,
			cleanupScopes:
				options?.cleanupScopes === undefined
					? parseScannerCleanupScopes(cleanupScope)
					: [...options.cleanupScopes],
			includeNodeModules:
				typeof options?.includeNodeModules === 'boolean'
					? options.includeNodeModules
					: config.includeNodeModules,
			includeProjectLocalPmCaches:
				typeof options?.includeProjectLocalPmCaches === 'boolean'
					? options.includeProjectLocalPmCaches
					: config.includeProjectLocalPmCaches,
			maxDepth: optionMaxDepth ?? configMaxDepth,
		},
	};
};

const resolveAllowedCandidateTypes = (
	options: ResolvedScanOptions,
): Set<CandidateType> => {
	const fromScope = new Set<CandidateType>();
	const cleanupScope = options.cleanupScope?.trim();

	if (!cleanupScope) {
		for (const candidateType of ALL_CANDIDATE_TYPES) {
			fromScope.add(candidateType);
		}
	} else {
		for (const rawScopeToken of cleanupScope.split(',')) {
			const normalizedToken = rawScopeToken.trim().toLowerCase();
			if (!normalizedToken) continue;
			const mappedTypes = CLEANUP_SCOPE_MAP[normalizedToken];
			if (!mappedTypes) continue;
			for (const mappedType of mappedTypes) {
				fromScope.add(mappedType);
			}
		}
	}

	if (fromScope.size === 0) {
		for (const candidateType of ALL_CANDIDATE_TYPES) {
			fromScope.add(candidateType);
		}
	}

	if (options.scannerOptions.includeNodeModules === false) {
		fromScope.delete('node_modules');
	}

	if (options.scannerOptions.includeProjectLocalPmCaches === false) {
		fromScope.delete('pm-cache');
	}

	return fromScope;
};

const parseScannerCleanupScopes = (
	cleanupScope: string | undefined,
): CleanupScope[] | undefined => {
	if (!cleanupScope || cleanupScope.trim().length === 0) {
		return undefined;
	}

	const resolved = new Set<CleanupScope>();
	for (const rawScopeToken of cleanupScope.split(',')) {
		const normalizedToken = rawScopeToken.trim().toLowerCase();
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

const buildCleanupScopeLabel = (options: ResolvedScanOptions): string => {
	const rawScope = options.cleanupScope ?? 'default';
	const normalizedScope = rawScope.replaceAll(' ', '');
	const scope =
		normalizedScope === 'project,workspace' ||
		normalizedScope === 'workspace,project'
			? 'all'
			: rawScope;
	const modifiers: string[] = [];
	if (options.scannerOptions.includeNodeModules === false) {
		modifiers.push('no-node-modules');
	}
	if (options.scannerOptions.includeProjectLocalPmCaches === false) {
		modifiers.push('no-pm-caches');
	}
	return modifiers.length === 0 ? scope : `${scope} (${modifiers.join(',')})`;
};

const normalizeItem = (raw: ScannerItem, cwd: string): ArtifactItem => ({
	path: raw.path,
	relPath: path.relative(cwd, raw.path) || '.',
	size: typeof raw.size === 'number' ? raw.size : 0,
	mtime: raw.mtime ? new Date(raw.mtime) : new Date(0),
	isDirectory: raw.isDirectory !== false,
	type: raw.type,
	candidateType: resolveCandidateType(raw),
	status: raw.status,
});

const statusColor = (kind: NonNullable<StatusState>['kind']) => {
	if (kind === 'error') return 'red';
	if (kind === 'success') return 'green';
	return 'yellow';
};

const buildShortcuts = (sortBy: SortMode): ShortcutHint[][] => [
	[
		{key: 'Up/Down', label: 'move'},
		{key: 'PgUp/PgDn', label: 'page'},
		{key: 'Home/End', label: 'jump'},
	],
	[
		{key: 'Space', label: 'select'},
		{key: 'A', label: 'all'},
		{key: 'C', label: 'clear'},
	],
	[
		{key: 'S', label: `sort (${sortBy})`},
		{key: 'R', label: 'rescan'},
		{key: 'D/Enter', label: 'delete'},
		{key: 'Q/Esc', label: 'quit'},
	],
];

const resolveConfig = (config?: Partial<PruneConfig>): PruneConfig => ({
	alwaysDelete: Array.isArray(config?.alwaysDelete)
		? config.alwaysDelete
		: DEFAULT_CONFIG.alwaysDelete,
	neverDelete: Array.isArray(config?.neverDelete)
		? config.neverDelete
		: DEFAULT_CONFIG.neverDelete,
	checkUnusedAssets:
		typeof config?.checkUnusedAssets === 'boolean'
			? config.checkUnusedAssets
			: DEFAULT_CONFIG.checkUnusedAssets,
	monorepoMode:
		typeof config?.monorepoMode === 'string'
			? config.monorepoMode
			: DEFAULT_CONFIG.monorepoMode,
	workspaceDiscoveryMode:
		typeof config?.workspaceDiscoveryMode === 'string'
			? config.workspaceDiscoveryMode
			: DEFAULT_CONFIG.workspaceDiscoveryMode,
	cleanupScopes: Array.isArray(config?.cleanupScopes)
		? config.cleanupScopes
		: DEFAULT_CONFIG.cleanupScopes,
	includeNodeModules:
		typeof config?.includeNodeModules === 'boolean'
			? config.includeNodeModules
			: DEFAULT_CONFIG.includeNodeModules,
	includeProjectLocalPmCaches:
		typeof config?.includeProjectLocalPmCaches === 'boolean'
			? config.includeProjectLocalPmCaches
			: DEFAULT_CONFIG.includeProjectLocalPmCaches,
	maxScanDepth:
		typeof config?.maxScanDepth === 'number' &&
		Number.isFinite(config.maxScanDepth) &&
		config.maxScanDepth >= 0
			? Math.floor(config.maxScanDepth)
			: DEFAULT_CONFIG.maxScanDepth,
});

const sumItemSizes = (items: readonly ArtifactItem[]): number =>
	items.reduce((total, item) => total + item.size, 0);

export default function App({
	cwd = process.cwd(),
	dryRun = false,
	confirmImmediately = false,
	testMode = false,
	config = DEFAULT_CONFIG,
	scanOptions,
}: AppProps) {
	const renderer = useRenderer();
	const {width, height} = useTerminalDimensions();
	const terminalWidth = Math.max(40, width || 80);
	const terminalHeight = Math.max(18, height || 24);
	const resolvedConfig = useMemo(() => resolveConfig(config), [config]);
	const resolvedScanOptions = useMemo(
		() => resolveScanOptions(scanOptions, resolvedConfig),
		[resolvedConfig, scanOptions],
	);
	const allowedCandidateTypes = useMemo(
		() => resolveAllowedCandidateTypes(resolvedScanOptions),
		[resolvedScanOptions],
	);
	const cleanupScopeLabel = useMemo(
		() => buildCleanupScopeLabel(resolvedScanOptions),
		[resolvedScanOptions],
	);

	const [items, setItems] = useState<ArtifactItem[]>([]);
	const [loading, setLoading] = useState(!testMode);
	const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
	const [focusedIndex, setFocusedIndex] = useState(0);
	const [sortBy, setSortBy] = useState<SortMode>('size');
	const [confirmOpen, setConfirmOpen] = useState(false);
	const [status, setStatus] = useState<StatusState>(null);

	const sortedItems = useMemo(() => {
		const next = [...items];
		next.sort((left, right) => {
			if (sortBy === 'size') return right.size - left.size;
			if (sortBy === 'age') return right.mtime.getTime() - left.mtime.getTime();
			return left.relPath.localeCompare(right.relPath);
		});
		return next;
	}, [items, sortBy]);

	const itemByPath = useMemo(
		() => new Map(items.map(item => [item.path, item])),
		[items],
	);

	const metrics = useMemo(() => {
		let foundCount = 0;
		let totalSize = 0;
		let selectedSize = 0;
		let nodeModulesCount = 0;
		let pmCachesCount = 0;
		for (const item of items) {
			if (item.status === 'deleted') continue;
			foundCount++;
			totalSize += item.size;
			if (item.candidateType === 'node_modules') {
				nodeModulesCount++;
			}
			if (item.candidateType === 'pm-cache') {
				pmCachesCount++;
			}
			if (selectedPaths.has(item.path)) {
				selectedSize += item.size;
			}
		}

		return {
			foundCount,
			totalSize,
			selectedSize,
			nodeModulesCount,
			pmCachesCount,
		};
	}, [items, selectedPaths]);

	const selectedTypeCounts = useMemo(() => {
		const counts = {
			artifact: 0,
			asset: 0,
			nodeModules: 0,
			pmCaches: 0,
		};

		for (const item of items) {
			if (item.status === 'deleted' || !selectedPaths.has(item.path)) continue;

			if (item.candidateType === 'asset') {
				counts.asset++;
				continue;
			}

			if (item.candidateType === 'node_modules') {
				counts.nodeModules++;
				continue;
			}

			if (item.candidateType === 'pm-cache') {
				counts.pmCaches++;
				continue;
			}

			counts.artifact++;
		}

		return counts;
	}, [items, selectedPaths]);

	const selectedIndices = useMemo(() => {
		const next = new Set<number>();
		for (const [index, item] of sortedItems.entries()) {
			if (selectedPaths.has(item.path)) {
				next.add(index);
			}
		}

		return next;
	}, [selectedPaths, sortedItems]);

	const listHeight = useMemo(() => {
		const base = Math.max(5, terminalHeight - 12);
		return status ? Math.max(3, base - 2) : base;
	}, [status, terminalHeight]);

	const viewWindow = useMemo(() => {
		const total = sortedItems.length;
		const half = Math.floor(listHeight / 2);
		let start = Math.max(0, focusedIndex - half);
		const end = start + listHeight;
		if (end > total) {
			start = Math.max(0, total - listHeight);
		}

		return {
			start,
			end: Math.min(start + listHeight, total),
		};
	}, [focusedIndex, listHeight, sortedItems.length]);

	const shortcuts = useMemo(() => buildShortcuts(sortBy), [sortBy]);

	const quit = useCallback(() => {
		renderer.destroy();
	}, [renderer]);

	const collectItems = useCallback(async (): Promise<ArtifactItem[]> => {
		const scannerOptions = resolvedScanOptions.scannerOptions;
		let next: ScannerItem[] = await scanArtifacts(cwd, scannerOptions);

		if (resolvedConfig.checkUnusedAssets) {
			const assetPaths = await findUnusedAssets(cwd, {
				skipDirs: scannerOptions.skipDirs,
			});
			const assetStats = await Promise.all(
				assetPaths.map(async assetPath => getArtifactStats(assetPath)),
			);
			next = next.concat(
				assetPaths.map((assetPath, index) => ({
					path: assetPath,
					...assetStats[index],
					type: 'asset' as const,
				})),
			);
		}

		next = filterNeverDelete(next, cwd, resolvedConfig.neverDelete);
		return next
			.map(item => normalizeItem(item, cwd))
			.filter(item => allowedCandidateTypes.has(item.candidateType));
	}, [
		allowedCandidateTypes,
		cwd,
		resolvedConfig.checkUnusedAssets,
		resolvedConfig.neverDelete,
		resolvedScanOptions,
	]);

	const runScan = useCallback(async () => {
		setLoading(true);
		setStatus(null);

		try {
			const next = await collectItems();
			setItems(next);
			setFocusedIndex(0);
			setSelectedPaths(previous => {
				const available = new Set(next.map(item => item.path));
				return new Set(
					[...previous].filter(itemPath => available.has(itemPath)),
				);
			});
		} catch (error) {
			setStatus({
				kind: 'error',
				message: String(
					error instanceof Error ? error.message : (error ?? 'Scan failed'),
				),
			});
		} finally {
			setLoading(false);
		}
	}, [collectItems]);

	const moveFocusBy = useCallback(
		(delta: number) => {
			setFocusedIndex(previous =>
				clampIndex(previous + delta, sortedItems.length),
			);
		},
		[sortedItems.length],
	);

	const jumpFocusTo = useCallback(
		(target: number) => {
			setFocusedIndex(clampIndex(target, sortedItems.length));
		},
		[sortedItems.length],
	);

	const toggleFocusedSelection = useCallback(() => {
		const focusedItem = sortedItems[focusedIndex];
		if (!focusedItem || focusedItem.status === 'deleted') return;

		setSelectedPaths(previous => {
			const next = new Set(previous);
			if (next.has(focusedItem.path)) {
				next.delete(focusedItem.path);
			} else {
				next.add(focusedItem.path);
			}

			return next;
		});
	}, [focusedIndex, sortedItems]);

	const selectAll = useCallback(() => {
		const paths = sortedItems
			.filter(item => item.status !== 'deleted')
			.map(item => item.path);
		setSelectedPaths(new Set(paths));
	}, [sortedItems]);

	const cycleSort = useCallback(() => {
		setSortBy(previous => {
			const nextIndex = (SORT_MODES.indexOf(previous) + 1) % SORT_MODES.length;
			return SORT_MODES[nextIndex];
		});
	}, []);

	const openDeleteConfirm = useCallback(() => {
		if (selectedPaths.size > 0) {
			setConfirmOpen(true);
			return;
		}

		const focusedItem = sortedItems[focusedIndex];
		if (!focusedItem || focusedItem.status === 'deleted') return;
		setSelectedPaths(new Set([focusedItem.path]));
		setConfirmOpen(true);
	}, [focusedIndex, selectedPaths.size, sortedItems]);

	const performDeletion = useCallback(async () => {
		const targets = [...selectedPaths]
			.map(targetPath => itemByPath.get(targetPath))
			.filter((item): item is ArtifactItem =>
				Boolean(item && item.status !== 'deleted'),
			);

		if (targets.length === 0) {
			setConfirmOpen(false);
			return;
		}

		const targetSet = new Set(targets.map(item => item.path));

		if (dryRun) {
			setItems(previous =>
				previous.map(item =>
					targetSet.has(item.path) ? {...item, status: 'dry-run'} : item,
				),
			);
			setStatus({
				kind: 'success',
				message: `Dry-run: would delete ${targets.length} items (${human(sumItemSizes(targets))})`,
			});
			setSelectedPaths(new Set());
			setConfirmOpen(false);
			return;
		}

		setItems(previous =>
			previous.map(item =>
				targetSet.has(item.path) ? {...item, status: 'deleting'} : item,
			),
		);

		const summary = await deleteItems(
			targets.map(item => ({
				path: item.path,
				size: item.size,
			})),
		);

		const succeeded = new Set<string>();
		const failed = new Set<string>();
		for (const result of summary.results) {
			if (result.ok) {
				succeeded.add(result.path);
			} else {
				failed.add(result.path);
			}
		}

		setItems(previous =>
			previous.map(item => {
				if (succeeded.has(item.path)) {
					return {...item, status: 'deleted', size: 0};
				}

				if (failed.has(item.path)) {
					return {...item, status: 'error'};
				}

				return item;
			}),
		);

		if (summary.failureCount > 0 && summary.deletedCount > 0) {
			setStatus({
				kind: 'info',
				message: `Deleted ${summary.deletedCount} items (freed ${human(summary.reclaimedBytes)}), ${summary.failureCount} failed`,
			});
		} else if (summary.failureCount > 0) {
			setStatus({
				kind: 'error',
				message: `Failed to delete: ${summary.results.find(result => !result.ok)?.path ?? 'unknown path'}`,
			});
		} else {
			setStatus({
				kind: 'success',
				message: `Deleted ${summary.deletedCount} items (freed ${human(summary.reclaimedBytes)})`,
			});
		}

		setSelectedPaths(new Set());
		setConfirmOpen(false);
	}, [dryRun, itemByPath, selectedPaths]);

	useKeyboard(key => {
		const keyName = String(key.name ?? '').toLowerCase();
		const isEnter = keyName === 'enter' || keyName === 'return';

		if (confirmOpen) {
			if (keyName === 'escape' || keyName === 'n') {
				setConfirmOpen(false);
				return;
			}

			if (keyName === 'y' || isEnter) {
				void performDeletion();
			}

			return;
		}

		if (key.ctrl && keyName === 'c') {
			quit();
			return;
		}

		if (keyName === 'escape' || keyName === 'q') {
			quit();
			return;
		}

		if (keyName === 'up') {
			moveFocusBy(-1);
			return;
		}

		if (keyName === 'down') {
			moveFocusBy(1);
			return;
		}

		if (keyName === 'pageup') {
			moveFocusBy(-listHeight);
			return;
		}

		if (keyName === 'pagedown') {
			moveFocusBy(listHeight);
			return;
		}

		if (keyName === 'home') {
			jumpFocusTo(0);
			return;
		}

		if (keyName === 'end') {
			jumpFocusTo(sortedItems.length - 1);
			return;
		}

		if (keyName === 'space') {
			toggleFocusedSelection();
			return;
		}

		if (keyName === 'a') {
			selectAll();
			return;
		}

		if (keyName === 'c') {
			setSelectedPaths(new Set());
			return;
		}

		if (keyName === 's') {
			cycleSort();
			return;
		}

		if (keyName === 'r' && !loading) {
			void runScan();
			return;
		}

		if (keyName === 'd' || isEnter) {
			openDeleteConfirm();
		}
	});

	useEffect(() => {
		if (!testMode) {
			void runScan();
		}
	}, [runScan, testMode]);

	useEffect(() => {
		if (items.length === 0 || testMode) return;

		if (confirmImmediately) {
			const allPaths = items
				.filter(item => item.status !== 'deleted')
				.map(item => item.path);
			setSelectedPaths(new Set(allPaths));
			setConfirmOpen(true);
			return;
		}

		if (resolvedConfig.alwaysDelete.length === 0) {
			return;
		}

		const preselected = selectAlwaysDeletePaths(
			items.filter(item => item.status !== 'deleted'),
			cwd,
			resolvedConfig.alwaysDelete,
		);

		if (preselected.size > 0) {
			setSelectedPaths(preselected);
		}
	}, [confirmImmediately, cwd, items, resolvedConfig.alwaysDelete, testMode]);

	return (
		<box
			flexDirection="column"
			padding={1}
			height={terminalHeight}
			width={terminalWidth}
		>
			<Header />

			<box marginTop={1} marginBottom={1}>
				<Dashboard
					foundCount={metrics.foundCount}
					totalSize={metrics.totalSize}
					selectedCount={selectedPaths.size}
					selectedSize={metrics.selectedSize}
					nodeModulesCount={metrics.nodeModulesCount}
					pmCachesCount={metrics.pmCachesCount}
					cleanupScopeLabel={cleanupScopeLabel}
					loading={loading}
					cwd={cwd}
					terminalWidth={terminalWidth}
				/>
			</box>

			<box
				flexGrow={1}
				border
				borderStyle="rounded"
				borderColor={selectedPaths.size > 0 ? 'yellow' : 'gray'}
				paddingLeft={1}
				paddingRight={1}
				flexDirection="column"
			>
				{status ? (
					<box border borderColor={statusColor(status.kind)} marginBottom={1}>
						<text>
							<span fg={statusColor(status.kind)}>{status.message}</span>
						</text>
					</box>
				) : null}

				<ArtifactList
					items={sortedItems}
					focusedIndex={focusedIndex}
					selectedIndices={selectedIndices}
					viewStart={viewWindow.start}
					viewEnd={viewWindow.end}
					height={listHeight}
				/>
			</box>

			<box marginTop={1}>
				<Footer shortcuts={shortcuts} />
			</box>

			{confirmOpen ? (
				<ConfirmModal
					count={selectedPaths.size}
					size={metrics.selectedSize}
					dryRun={dryRun}
					selectedTypeCounts={selectedTypeCounts}
					terminalWidth={terminalWidth}
					terminalHeight={terminalHeight}
				/>
			) : null}
		</box>
	);
}
