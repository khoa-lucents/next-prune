import path from 'node:path';
import {DEFAULT_CONFIG} from '../../core/config.js';
import type {
	CleanupScope,
	PruneConfig,
	RuntimeScanOptions,
	ScannerOptions,
	ScanItem,
} from '../../core/types.js';
import type {
	ArtifactItem,
	ArtifactStatus,
	CandidateType,
	SortMode,
} from '../types.js';

export type ResolvedScanOptions = {
	cleanupScope?: string;
	scannerOptions: ScannerOptions;
};

type ScannerItem = ScanItem & {status?: ArtifactStatus};

export const SORT_MODES: SortMode[] = ['size', 'age', 'path'];
export const ALL_CANDIDATE_TYPES: CandidateType[] = [
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

const normalizePathForMatching = (value: string): string =>
	value.split(path.sep).join('/').toLowerCase();

export const clampIndex = (nextIndex: number, totalItems: number): number => {
	if (totalItems <= 0) return 0;
	return Math.max(0, Math.min(totalItems - 1, nextIndex));
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

export const resolveCandidateType = (
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

export const resolveConfig = (config?: Partial<PruneConfig>): PruneConfig => ({
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

export const resolveScanOptions = (
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

export const resolveAllowedCandidateTypes = (
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

export const buildCleanupScopeLabel = (
	options: ResolvedScanOptions,
): string => {
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

export const normalizeItem = (raw: ScannerItem, cwd: string): ArtifactItem => ({
	path: raw.path,
	relPath: path.relative(cwd, raw.path) || '.',
	size: typeof raw.size === 'number' ? raw.size : 0,
	mtime:
		raw.mtime instanceof Date
			? raw.mtime
			: raw.mtime
				? new Date(raw.mtime)
				: new Date(0),
	isDirectory: raw.isDirectory !== false,
	type: raw.type,
	candidateType: resolveCandidateType(raw),
	status: raw.status,
});

export const sumItemSizes = (items: readonly ArtifactItem[]): number =>
	items.reduce((total, item) => total + item.size, 0);
