import fs from 'node:fs/promises';
import path from 'node:path';
import type {
	CleanupScope,
	MonorepoMode,
	PruneConfig,
	ScanItem,
	WorkspaceDiscoveryMode,
} from './types.js';

const PATH_SEGMENT_NORMALIZER = /\/+/g;
const MONOREPO_MODES: readonly MonorepoMode[] = ['auto', 'on', 'off'];
const WORKSPACE_DISCOVERY_MODES: readonly WorkspaceDiscoveryMode[] = [
	'manifest-fallback',
	'manifest-only',
	'heuristic-only',
];
const CLEANUP_SCOPES: readonly CleanupScope[] = ['project', 'workspace'];

export const DEFAULT_MONOREPO_MODE: MonorepoMode = 'auto';
export const DEFAULT_WORKSPACE_DISCOVERY_MODE: WorkspaceDiscoveryMode =
	'manifest-fallback';
export const DEFAULT_CLEANUP_SCOPES: CleanupScope[] = ['project', 'workspace'];
export const DEFAULT_INCLUDE_NODE_MODULES = true;
export const DEFAULT_INCLUDE_PROJECT_LOCAL_PM_CACHES = true;

export const DEFAULT_CONFIG: PruneConfig = {
	alwaysDelete: [],
	neverDelete: [],
	checkUnusedAssets: false,
	monorepoMode: DEFAULT_MONOREPO_MODE,
	workspaceDiscoveryMode: DEFAULT_WORKSPACE_DISCOVERY_MODE,
	cleanupScopes: [...DEFAULT_CLEANUP_SCOPES],
	includeNodeModules: DEFAULT_INCLUDE_NODE_MODULES,
	includeProjectLocalPmCaches: DEFAULT_INCLUDE_PROJECT_LOCAL_PM_CACHES,
};

const toPosixPath = (value: string): string => value.replaceAll('\\', '/');

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const normalizePathPattern = (
	value: string,
	{allowEmpty = false}: {allowEmpty?: boolean} = {},
): string | null => {
	let normalized = toPosixPath(value.trim());
	if (!normalized) return allowEmpty ? '' : null;

	normalized = normalized.replace(/^\.\/+/, '');
	normalized = normalized.replace(/^\/+/, '');
	normalized = normalized.replace(PATH_SEGMENT_NORMALIZER, '/');
	normalized = normalized.replace(/\/+$/, '');

	if (!normalized || normalized === '.') {
		return allowEmpty ? '' : null;
	}

	normalized = path.posix.normalize(normalized);
	if (normalized === '.' || normalized === '') {
		return allowEmpty ? '' : null;
	}

	if (
		normalized === '..' ||
		normalized.startsWith('../') ||
		normalized.includes('/../') ||
		/^[A-Za-z]:\//.test(normalized)
	) {
		return null;
	}

	return normalized;
};

const normalizePatternList = (value: unknown): string[] => {
	if (!Array.isArray(value)) return [];

	const unique = new Set<string>();
	for (const entry of value) {
		if (typeof entry !== 'string') continue;
		const normalized = normalizePathPattern(entry);
		if (normalized) unique.add(normalized);
	}

	return [...unique];
};

const parseBoolean = (value: unknown, fallback = false): boolean =>
	typeof value === 'boolean' ? value : fallback;

const parseMonorepoMode = (
	value: unknown,
	fallback: MonorepoMode = DEFAULT_MONOREPO_MODE,
): MonorepoMode =>
	typeof value === 'string' && MONOREPO_MODES.includes(value as MonorepoMode)
		? (value as MonorepoMode)
		: fallback;

const parseWorkspaceDiscoveryMode = (
	value: unknown,
	fallback: WorkspaceDiscoveryMode = DEFAULT_WORKSPACE_DISCOVERY_MODE,
): WorkspaceDiscoveryMode =>
	typeof value === 'string'
		? (({
				auto: 'manifest-fallback',
				manifest: 'manifest-only',
				heuristic: 'heuristic-only',
			}[value] as WorkspaceDiscoveryMode | undefined) ??
			(WORKSPACE_DISCOVERY_MODES.includes(value as WorkspaceDiscoveryMode)
				? (value as WorkspaceDiscoveryMode)
				: fallback))
		: fallback;

const parseMaxDepth = (value: unknown): number | undefined => {
	if (typeof value !== 'number') return undefined;
	if (!Number.isInteger(value) || value < 0) return undefined;
	return value;
};

export const normalizeCleanupScopes = (
	value: unknown,
	fallback: readonly CleanupScope[] = DEFAULT_CLEANUP_SCOPES,
): CleanupScope[] => {
	if (!Array.isArray(value)) return [...fallback];

	const unique = new Set<CleanupScope>();
	for (const entry of value) {
		if (typeof entry !== 'string') continue;
		if (!CLEANUP_SCOPES.includes(entry as CleanupScope)) continue;
		unique.add(entry as CleanupScope);
	}

	return [...unique];
};

export const normalizeMonorepoMode = (
	value: unknown,
	fallback: MonorepoMode = DEFAULT_MONOREPO_MODE,
): MonorepoMode => parseMonorepoMode(value, fallback);

export const normalizeWorkspaceDiscoveryMode = (
	value: unknown,
	fallback: WorkspaceDiscoveryMode = DEFAULT_WORKSPACE_DISCOVERY_MODE,
): WorkspaceDiscoveryMode => parseWorkspaceDiscoveryMode(value, fallback);

const normalizeConfig = (value: unknown): PruneConfig => {
	const raw = isRecord(value) ? value : {};

	return {
		alwaysDelete: normalizePatternList(raw.alwaysDelete),
		neverDelete: normalizePatternList(raw.neverDelete),
		checkUnusedAssets: parseBoolean(raw.checkUnusedAssets, false),
		monorepoMode: parseMonorepoMode(raw.monorepoMode),
		workspaceDiscoveryMode: parseWorkspaceDiscoveryMode(
			raw.workspaceDiscoveryMode,
		),
		cleanupScopes: normalizeCleanupScopes(raw.cleanupScopes),
		includeNodeModules: parseBoolean(
			raw.includeNodeModules,
			DEFAULT_INCLUDE_NODE_MODULES,
		),
		includeProjectLocalPmCaches: parseBoolean(
			raw.includeProjectLocalPmCaches,
			DEFAULT_INCLUDE_PROJECT_LOCAL_PM_CACHES,
		),
		maxScanDepth: parseMaxDepth(raw.maxScanDepth),
	};
};

const readJson = async (filePath: string): Promise<Record<string, unknown>> => {
	try {
		const content = await fs.readFile(filePath, 'utf8');
		const parsed = JSON.parse(content) as unknown;
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
};

export const normalizeConfigPattern = (
	pattern: string | null | undefined,
): string | null => {
	if (typeof pattern !== 'string') return null;
	return normalizePathPattern(pattern);
};

export const normalizeRelativePath = (relativePath: string): string => {
	const normalized = normalizePathPattern(relativePath, {allowEmpty: true});
	return normalized ?? '';
};

export const matchesConfigPattern = (
	relativePath: string,
	pattern: string,
): boolean => {
	const normalizedPattern = normalizeConfigPattern(pattern);
	if (!normalizedPattern) return false;

	const normalizedRelativePath = normalizeRelativePath(relativePath);
	return (
		normalizedRelativePath === normalizedPattern ||
		normalizedRelativePath.startsWith(`${normalizedPattern}/`)
	);
};

export const matchesAnyConfigPattern = (
	relativePath: string,
	patterns: Iterable<string>,
): boolean => {
	for (const pattern of patterns) {
		if (matchesConfigPattern(relativePath, pattern)) return true;
	}

	return false;
};

export const filterNeverDelete = <T extends Pick<ScanItem, 'path'>>(
	items: readonly T[],
	cwd: string,
	neverDeletePatterns: Iterable<string>,
): T[] => {
	const normalizedPatterns = normalizePatternList([...neverDeletePatterns]);
	if (normalizedPatterns.length === 0) return [...items];

	return items.filter(item => {
		const relativePath = path.relative(cwd, item.path);
		return !matchesAnyConfigPattern(relativePath, normalizedPatterns);
	});
};

export const selectAlwaysDeletePaths = (
	items: readonly Pick<ScanItem, 'path'>[],
	cwd: string,
	alwaysDeletePatterns: Iterable<string>,
): Set<string> => {
	const normalizedPatterns = normalizePatternList([...alwaysDeletePatterns]);
	const selected = new Set<string>();
	if (normalizedPatterns.length === 0) return selected;

	for (const item of items) {
		const relativePath = path.relative(cwd, item.path);
		if (matchesAnyConfigPattern(relativePath, normalizedPatterns)) {
			selected.add(item.path);
		}
	}

	return selected;
};

export const loadConfig = async (cwd: string): Promise<PruneConfig> => {
	const packageJson = await readJson(path.join(cwd, 'package.json'));
	const packageConfig = isRecord(packageJson['next-prune'])
		? packageJson['next-prune']
		: {};
	const rcConfig = await readJson(path.join(cwd, '.next-prunerc.json'));

	return normalizeConfig({
		...DEFAULT_CONFIG,
		...packageConfig,
		...rcConfig,
	});
};
