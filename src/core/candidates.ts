import path from 'node:path';
import type {CleanupScope, ScanItem} from './types.js';

export type CandidateType = 'artifact' | 'asset' | 'node_modules' | 'pm-cache';

export interface CandidateFilterOptions {
	cleanupScope?: string;
	includeNodeModules?: boolean;
	includeProjectLocalPmCaches?: boolean;
}

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
	'cold-storage': ALL_CANDIDATE_TYPES,
	coldstorage: ALL_CANDIDATE_TYPES,
	archive: ALL_CANDIDATE_TYPES,
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

export const parseCleanupScope = (
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
				`Invalid --cleanup-scope value: "${rawToken}". Expected one or more of: all, cold-storage, project, workspace, safe, node-modules, pm-caches`,
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

export const resolveAllowedCandidateTypes = (
	options: CandidateFilterOptions,
): Set<CandidateType> => {
	const allowed = parseCleanupScope(options.cleanupScope);
	if (options.includeNodeModules === false) {
		allowed.delete('node_modules');
	}
	if (options.includeProjectLocalPmCaches === false) {
		allowed.delete('pm-cache');
	}
	return allowed;
};

export const parseScannerCleanupScopes = (
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
		if (
			normalizedToken === 'cold-storage' ||
			normalizedToken === 'coldstorage' ||
			normalizedToken === 'archive'
		) {
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

export const isApplyProtectedCandidate = (
	item: Pick<ScanItem, 'path' | 'type' | 'cleanupType'>,
): boolean => {
	const candidateType = resolveCandidateType(item);
	return candidateType === 'node_modules' || candidateType === 'pm-cache';
};

export const buildCleanupScopeLabel = (
	options: CandidateFilterOptions,
): string => {
	const rawScope = options.cleanupScope ?? 'default';
	const normalizedScope = rawScope.replaceAll(' ', '');
	const scope =
		normalizedScope === 'project,workspace' ||
		normalizedScope === 'workspace,project'
			? 'all'
			: rawScope;
	const modifiers: string[] = [];
	if (options.includeNodeModules === false) {
		modifiers.push('no-node-modules');
	}
	if (options.includeProjectLocalPmCaches === false) {
		modifiers.push('no-pm-caches');
	}
	return modifiers.length === 0 ? scope : `${scope} (${modifiers.join(',')})`;
};
