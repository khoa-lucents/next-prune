import fs from 'node:fs/promises';
import type {Dirent, Stats} from 'node:fs';
import path from 'node:path';
import {
	DEFAULT_CLEANUP_SCOPES,
	DEFAULT_INCLUDE_NODE_MODULES,
	DEFAULT_INCLUDE_PROJECT_LOCAL_PM_CACHES,
	DEFAULT_MONOREPO_MODE,
	DEFAULT_WORKSPACE_DISCOVERY_MODE,
	normalizeCleanupScopes,
	normalizeMonorepoMode,
	normalizeWorkspaceDiscoveryMode,
} from './config.js';
import type {
	ArtifactStats,
	CleanupScope,
	CleanupType,
	ScanItem,
	ScannerOptions,
} from './types.js';
import {discoverWorkspaces} from './workspaces.js';

export const ARTIFACT_NAMES = new Set([
	'.next',
	'out',
	'.turbo',
	'.vercel_build_output',
	'coverage',
	'.swc',
	'.docusaurus',
	'storybook-static',
]);

export const DEFAULT_SCAN_SKIP_DIRS = new Set([
	'.git',
	'.svn',
	'.hg',
	'.next',
	'.turbo',
	'.vercel',
	'node_modules',
	'coverage',
	'.swc',
	'.docusaurus',
	'storybook-static',
]);

const NEXT_CONFIG_FILES = [
	'next.config.js',
	'next.config.mjs',
	'next.config.cjs',
	'next.config.ts',
	'next.config.mts',
	'next.config.cts',
] as const;

const NEXT_CONFIG_FILE_SET = new Set<string>(NEXT_CONFIG_FILES);
const DIST_DIR_PATTERN = /\bdistDir\s*:\s*(['"`])([^'"`]+)\1/;

const PROJECT_LOCAL_PM_CACHE_PATHS: readonly string[][] = [
	['.npm'],
	['.pnpm-store'],
	['.yarn', 'cache'],
	['.yarn', 'unplugged'],
	['.bun', 'install', 'cache'],
];

const EMPTY_STATS: ArtifactStats = {
	size: 0,
	mtime: new Date(0),
	fileCount: 0,
	isDirectory: false,
};

interface ScanRoot {
	path: string;
	scope: CleanupScope;
}

interface CandidateMetadata {
	cleanupScope: CleanupScope;
	cleanupType: CleanupType;
}

interface ContainedPath {
	path: string;
	realpath: string;
}

interface DiscoveredCandidate extends CandidateMetadata {
	path: string;
}

const toErrorMessage = (error: unknown): string =>
	String(error instanceof Error ? error.message : error);

const stripJavaScriptComments = (source: string): string =>
	source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/.*$/gm, '');

const normalizeRelativeDirectory = (value: unknown): string | null => {
	if (typeof value !== 'string') return null;

	let normalized = value.trim().replaceAll('\\', '/');
	if (!normalized) return null;

	normalized = normalized.replace(/^\.\/+/, '');
	normalized = normalized.replace(/\/+/g, '/');
	normalized = normalized.replace(/\/+$/, '');
	if (!normalized || normalized === '.') return null;

	normalized = path.posix.normalize(normalized);
	if (!normalized || normalized === '.') return null;

	if (
		normalized === '..' ||
		normalized.startsWith('../') ||
		normalized.includes('/../') ||
		normalized.startsWith('/') ||
		/^[A-Za-z]:\//.test(normalized)
	) {
		return null;
	}

	return normalized;
};

const isContainedPath = (rootPath: string, targetPath: string): boolean =>
	targetPath === rootPath || targetPath.startsWith(`${rootPath}${path.sep}`);

const toContainedPath = async (
	rootPath: string,
	targetPath: string,
): Promise<ContainedPath | null> => {
	try {
		const resolvedPath = path.resolve(targetPath);
		const resolvedRealpath = await fs.realpath(resolvedPath);
		if (!isContainedPath(rootPath, resolvedRealpath)) return null;
		return {path: resolvedPath, realpath: resolvedRealpath};
	} catch {
		return null;
	}
};

const findCustomDistDir = async (
	directory: string,
	entries: Dirent[],
): Promise<string | null> => {
	const configEntry = entries.find(entry =>
		NEXT_CONFIG_FILE_SET.has(entry.name),
	);
	if (!configEntry) return null;

	try {
		const configPath = path.join(directory, configEntry.name);
		const configSource = await fs.readFile(configPath, 'utf8');
		const sanitizedSource = stripJavaScriptComments(configSource);
		const match = DIST_DIR_PATTERN.exec(sanitizedSource);
		if (!match?.[2]) return null;

		const relativeDistDir = normalizeRelativeDirectory(match[2]);
		if (!relativeDistDir) return null;

		const fullPath = path.join(directory, ...relativeDistDir.split('/'));
		const stat = await fs.stat(fullPath);
		return stat.isDirectory() ? path.resolve(fullPath) : null;
	} catch {
		return null;
	}
};

const findProjectLocalPmCacheCandidates = async (
	directory: string,
): Promise<string[]> => {
	const candidates = await Promise.all(
		PROJECT_LOCAL_PM_CACHE_PATHS.map(async segments => {
			const candidatePath = path.join(directory, ...segments);
			try {
				const stat = await fs.stat(candidatePath);
				return stat.isDirectory() ? path.resolve(candidatePath) : null;
			} catch {
				return null;
			}
		}),
	);

	return candidates.filter((candidate): candidate is string =>
		Boolean(candidate),
	);
};

const findVercelOutputArtifact = async (
	vercelPath: string,
): Promise<string | null> => {
	const outputPath = path.join(vercelPath, 'output');

	try {
		const stat = await fs.stat(outputPath);
		return stat.isDirectory() ? path.resolve(outputPath) : null;
	} catch {
		return null;
	}
};

const collectStats = async (targetPath: string): Promise<ArtifactStats> => {
	let stat: Stats;
	try {
		stat = await fs.lstat(targetPath);
	} catch (error) {
		return {...EMPTY_STATS, error: toErrorMessage(error)};
	}

	if (!stat.isDirectory()) {
		return {
			size: stat.size,
			fileCount: 1,
			mtime: stat.mtime,
			isDirectory: false,
		};
	}

	let entries: Dirent[];
	try {
		entries = await fs.readdir(targetPath, {withFileTypes: true});
	} catch (error) {
		return {
			size: 0,
			fileCount: 0,
			mtime: stat.mtime,
			isDirectory: true,
			error: toErrorMessage(error),
		};
	}

	const nestedStats = await Promise.all(
		entries.map(async entry => collectStats(path.join(targetPath, entry.name))),
	);

	let size = 0;
	let fileCount = 0;
	let latestMtime = stat.mtime;
	for (const nested of nestedStats) {
		size += nested.size;
		fileCount += nested.fileCount;
		if (nested.mtime > latestMtime) {
			latestMtime = nested.mtime;
		}
	}

	return {
		size,
		fileCount,
		mtime: latestMtime,
		isDirectory: true,
	};
};

export const getArtifactStats = async (
	targetPath: string,
): Promise<ArtifactStats> => collectStats(targetPath);

export const scanArtifacts = async (
	cwd: string,
	options: ScannerOptions = {},
): Promise<ScanItem[]> => {
	const rootDirectory = path.resolve(cwd);
	const rootRealpath = await fs
		.realpath(rootDirectory)
		.catch(() => rootDirectory);
	const discoveredArtifacts = new Map<string, DiscoveredCandidate>();
	const processedDirectories = new Set<string>();
	const skipPaths = new Set<string>();
	const skipDirs = new Set(DEFAULT_SCAN_SKIP_DIRS);

	const cleanupScopes = normalizeCleanupScopes(
		options.cleanupScopes ? [...options.cleanupScopes] : undefined,
		DEFAULT_CLEANUP_SCOPES,
	);
	const cleanupScopeSet = new Set<CleanupScope>(cleanupScopes);
	const monorepoMode = normalizeMonorepoMode(
		options.monorepoMode,
		DEFAULT_MONOREPO_MODE,
	);
	const workspaceDiscoveryMode = normalizeWorkspaceDiscoveryMode(
		options.workspaceDiscoveryMode,
		DEFAULT_WORKSPACE_DISCOVERY_MODE,
	);
	const includeNodeModules =
		typeof options.includeNodeModules === 'boolean'
			? options.includeNodeModules
			: DEFAULT_INCLUDE_NODE_MODULES;
	const includeProjectLocalPmCaches =
		typeof options.includeProjectLocalPmCaches === 'boolean'
			? options.includeProjectLocalPmCaches
			: DEFAULT_INCLUDE_PROJECT_LOCAL_PM_CACHES;
	const maxDepth =
		typeof options.maxDepth === 'number' &&
		Number.isInteger(options.maxDepth) &&
		options.maxDepth >= 0
			? options.maxDepth
			: undefined;

	for (const skipDir of options.skipDirs ?? []) {
		if (typeof skipDir === 'string' && skipDir.length > 0) {
			skipDirs.add(skipDir);
		}
	}

	let workspaceDirectories: string[] = [];
	const shouldDiscoverWorkspaces =
		cleanupScopeSet.has('workspace') && monorepoMode !== 'off';
	if (shouldDiscoverWorkspaces) {
		const workspaceResult = await discoverWorkspaces(
			rootDirectory,
			workspaceDiscoveryMode,
		);
		workspaceDirectories = workspaceResult.workspaceDirectories;
	}

	const workspaceRoots = workspaceDirectories.map(directory => ({
		realpath: directory,
		path: path.join(rootDirectory, path.relative(rootRealpath, directory)),
	}));

	const scanRoots: ScanRoot[] = [];
	if (cleanupScopeSet.has('project')) {
		scanRoots.push({path: rootDirectory, scope: 'project'});
	}
	if (cleanupScopeSet.has('workspace') && workspaceDirectories.length > 0) {
		scanRoots.push(
			...workspaceRoots.map(workspace => ({
				path: workspace.path,
				scope: 'workspace' as const,
			})),
		);
	}

	if (scanRoots.length === 0) return [];

	const workspaceDirectorySet = new Set(
		workspaceRoots.map(root => root.realpath),
	);
	const skipWorkspaceSubtreesInProjectScope =
		workspaceDirectories.length > 0 && cleanupScopeSet.has('workspace');

	const addCandidate = async (
		candidatePath: string,
		metadata: CandidateMetadata,
	): Promise<void> => {
		const containedPath = await toContainedPath(rootRealpath, candidatePath);
		if (!containedPath) return;

		skipPaths.add(containedPath.realpath);
		const existing = discoveredArtifacts.get(containedPath.realpath);
		if (!existing) {
			discoveredArtifacts.set(containedPath.realpath, {
				...metadata,
				path: containedPath.path,
			});
			return;
		}

		if (
			existing.cleanupScope === 'project' &&
			metadata.cleanupScope === 'workspace'
		) {
			discoveredArtifacts.set(containedPath.realpath, {
				...metadata,
				path: containedPath.path,
			});
		}
	};

	const scanDirectory = async (
		directory: string,
		scanRoot: ScanRoot,
		depth: number,
	): Promise<void> => {
		const containedDirectory = await toContainedPath(rootRealpath, directory);
		if (!containedDirectory) return;
		if (processedDirectories.has(containedDirectory.realpath)) return;
		if (skipPaths.has(containedDirectory.realpath)) return;
		processedDirectories.add(containedDirectory.realpath);

		let entries: Dirent[];
		try {
			entries = await fs.readdir(containedDirectory.path, {
				withFileTypes: true,
			});
		} catch {
			return;
		}

		const customDistDir = await findCustomDistDir(
			containedDirectory.path,
			entries,
		);
		if (customDistDir) {
			await addCandidate(customDistDir, {
				cleanupScope: scanRoot.scope,
				cleanupType: 'artifact',
			});
		}

		const nextDirectories: string[] = [];
		const specialChecks: Array<Promise<void>> = [];

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;

			const absolutePath = path.resolve(
				path.join(containedDirectory.path, entry.name),
			);
			const containedPath = await toContainedPath(rootRealpath, absolutePath);
			if (!containedPath) continue;
			if (skipPaths.has(containedPath.realpath)) continue;

			if (
				scanRoot.scope === 'project' &&
				skipWorkspaceSubtreesInProjectScope &&
				workspaceDirectorySet.has(containedPath.realpath)
			) {
				continue;
			}

			if (ARTIFACT_NAMES.has(entry.name)) {
				await addCandidate(containedPath.path, {
					cleanupScope: scanRoot.scope,
					cleanupType: 'artifact',
				});
				continue;
			}

			if (entry.name === 'node_modules') {
				if (!includeNodeModules) {
					continue;
				}

				specialChecks.push(
					(async () => {
						await addCandidate(containedPath.path, {
							cleanupScope: scanRoot.scope,
							cleanupType:
								scanRoot.scope === 'workspace'
									? 'workspace-node-modules'
									: 'artifact',
						});
					})(),
				);
				continue;
			}

			if (entry.name === '.vercel') {
				specialChecks.push(
					(async () => {
						const vercelOutput = await findVercelOutputArtifact(
							containedPath.path,
						);
						if (!vercelOutput) return;
						await addCandidate(vercelOutput, {
							cleanupScope: scanRoot.scope,
							cleanupType: 'artifact',
						});
					})(),
				);
				continue;
			}

			if (skipDirs.has(entry.name)) {
				continue;
			}

			if (maxDepth !== undefined && depth >= maxDepth) {
				continue;
			}

			nextDirectories.push(containedPath.path);
		}

		await Promise.all(specialChecks);
		await Promise.all(
			nextDirectories.map(async next =>
				scanDirectory(next, scanRoot, depth + 1),
			),
		);
	};

	for (const scanRoot of scanRoots) {
		if (includeProjectLocalPmCaches) {
			const pmCacheCandidates = await findProjectLocalPmCacheCandidates(
				scanRoot.path,
			);
			for (const pmCacheCandidate of pmCacheCandidates) {
				await addCandidate(pmCacheCandidate, {
					cleanupScope: scanRoot.scope,
					cleanupType: 'pm-cache',
				});
			}
		}

		await scanDirectory(scanRoot.path, scanRoot, 0);
	}

	const items = await Promise.all(
		[...discoveredArtifacts.values()].map(async metadata => {
			const stats = await getArtifactStats(metadata.path);
			return {
				path: metadata.path,
				...stats,
				type: 'artifact' as const,
				cleanupScope: metadata.cleanupScope,
				cleanupType: metadata.cleanupType,
			};
		}),
	);

	return items.sort(
		(left, right) =>
			right.size - left.size || left.path.localeCompare(right.path),
	);
};
