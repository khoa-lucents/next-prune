import fs from 'node:fs/promises';
import type {Dirent} from 'node:fs';
import path from 'node:path';
import type {
	WorkspaceDiscoveryMode,
	WorkspaceDiscoveryResult,
	WorkspaceDiscoverySource,
} from './types.js';

const WORKSPACE_SKIP_DIRS = new Set([
	'.git',
	'.svn',
	'.hg',
	'node_modules',
	'.next',
	'.turbo',
	'.vercel',
	'coverage',
	'.swc',
	'.docusaurus',
	'storybook-static',
]);

const HEURISTIC_WORKSPACE_ROOTS = ['apps', 'packages', 'services', 'libs'];

const toPosixPath = (value: string): string => value.replaceAll('\\', '/');

const isRecord = (value: unknown): value is Record<string, unknown> =>
	Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const readJson = async (filePath: string): Promise<Record<string, unknown>> => {
	try {
		const content = await fs.readFile(filePath, 'utf8');
		const parsed = JSON.parse(content) as unknown;
		return isRecord(parsed) ? parsed : {};
	} catch {
		return {};
	}
};

const normalizeWorkspacePattern = (value: string): string | null => {
	const raw = value.trim();
	if (!raw) return null;

	const isNegated = raw.startsWith('!');
	let normalized = isNegated ? raw.slice(1).trim() : raw;
	if (!normalized) return null;

	normalized = toPosixPath(normalized);
	normalized = normalized.replace(/^\.\/+/, '');
	normalized = normalized.replace(/^\/+/, '');
	normalized = normalized.replace(/\/+/g, '/');
	normalized = normalized.replace(/\/+$/, '');
	if (!normalized || normalized === '.') return null;

	normalized = path.posix.normalize(normalized);
	if (!normalized || normalized === '.') return null;

	if (
		normalized === '..' ||
		normalized.startsWith('../') ||
		normalized.includes('/../') ||
		/^[A-Za-z]:\//.test(normalized)
	) {
		return null;
	}

	return isNegated ? `!${normalized}` : normalized;
};

const toUniqueNormalizedPatterns = (patterns: readonly string[]): string[] => {
	const unique = new Set<string>();
	for (const pattern of patterns) {
		const normalized = normalizeWorkspacePattern(pattern);
		if (normalized) unique.add(normalized);
	}
	return [...unique];
};

const listDirectories = async (directory: string): Promise<Dirent[]> => {
	try {
		return await fs.readdir(directory, {withFileTypes: true});
	} catch {
		return [];
	}
};

const isWildcardSegment = (segment: string): boolean =>
	segment.includes('*') || segment.includes('?');

const escapeRegex = (value: string): string =>
	value.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&');

const wildcardToRegex = (segment: string): RegExp =>
	new RegExp(
		`^${escapeRegex(segment).replaceAll('\\*', '[^/]*').replaceAll('\\?', '[^/]')}$`,
	);

const segmentMatchesPattern = (
	segment: string,
	patternSegment: string,
): boolean => wildcardToRegex(patternSegment).test(segment);

const matchPathSegments = (
	pathSegments: readonly string[],
	patternSegments: readonly string[],
	pathIndex = 0,
	patternIndex = 0,
): boolean => {
	if (patternIndex >= patternSegments.length) {
		return pathIndex >= pathSegments.length;
	}

	const currentPattern = patternSegments[patternIndex];
	if (currentPattern === '**') {
		if (patternIndex === patternSegments.length - 1) return true;
		for (let index = pathIndex; index <= pathSegments.length; index += 1) {
			if (
				matchPathSegments(
					pathSegments,
					patternSegments,
					index,
					patternIndex + 1,
				)
			) {
				return true;
			}
		}
		return false;
	}

	if (pathIndex >= pathSegments.length) return false;
	if (!segmentMatchesPattern(pathSegments[pathIndex], currentPattern)) {
		return false;
	}

	return matchPathSegments(
		pathSegments,
		patternSegments,
		pathIndex + 1,
		patternIndex + 1,
	);
};

const matchesWorkspacePattern = (
	relativePath: string,
	pattern: string,
): boolean => {
	const normalizedRelativePath = toPosixPath(relativePath)
		.replace(/^\.\/+/, '')
		.replace(/^\/+/, '')
		.replace(/\/+/g, '/')
		.replace(/\/+$/, '');
	if (!normalizedRelativePath) return false;

	const pathSegments = normalizedRelativePath.split('/').filter(Boolean);
	const patternSegments = pattern.split('/').filter(Boolean);
	return matchPathSegments(pathSegments, patternSegments);
};

const hasPackageJson = async (directory: string): Promise<boolean> => {
	try {
		const stat = await fs.stat(path.join(directory, 'package.json'));
		return stat.isFile();
	} catch {
		return false;
	}
};

const expandWorkspacePattern = async (
	rootDirectory: string,
	pattern: string,
): Promise<string[]> => {
	const normalizedPattern = normalizeWorkspacePattern(pattern);
	if (!normalizedPattern || normalizedPattern.startsWith('!')) return [];

	const results = new Set<string>();
	const segments = normalizedPattern.split('/').filter(Boolean);

	const walk = async (
		directory: string,
		segmentIndex: number,
	): Promise<void> => {
		if (segmentIndex >= segments.length) {
			if (await hasPackageJson(directory)) {
				results.add(path.resolve(directory));
			}
			return;
		}

		const currentSegment = segments[segmentIndex];
		if (currentSegment === '**') {
			await walk(directory, segmentIndex + 1);
			const entries = await listDirectories(directory);
			await Promise.all(
				entries.map(async entry => {
					if (!entry.isDirectory()) return;
					if (WORKSPACE_SKIP_DIRS.has(entry.name)) return;
					await walk(path.join(directory, entry.name), segmentIndex);
				}),
			);
			return;
		}

		if (isWildcardSegment(currentSegment)) {
			const matcher = wildcardToRegex(currentSegment);
			const entries = await listDirectories(directory);
			await Promise.all(
				entries.map(async entry => {
					if (!entry.isDirectory()) return;
					if (WORKSPACE_SKIP_DIRS.has(entry.name)) return;
					if (!matcher.test(entry.name)) return;
					await walk(path.join(directory, entry.name), segmentIndex + 1);
				}),
			);
			return;
		}

		const absolutePath = path.join(directory, currentSegment);
		try {
			const stat = await fs.stat(absolutePath);
			if (!stat.isDirectory()) return;
		} catch {
			return;
		}

		await walk(absolutePath, segmentIndex + 1);
	};

	await walk(rootDirectory, 0);
	return [...results];
};

const parsePnpmWorkspacePatterns = (content: string): string[] => {
	const patterns: string[] = [];
	const lines = content.split(/\r?\n/);
	let inPackagesSection = false;

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;

		if (!inPackagesSection) {
			if (/^packages\s*:/.test(trimmed)) {
				inPackagesSection = true;
			}
			continue;
		}

		if (/^[A-Za-z0-9_-]+\s*:/.test(trimmed)) {
			break;
		}

		const match = /^-\s*["']?([^"']+)["']?\s*$/.exec(trimmed);
		if (match?.[1]) {
			patterns.push(match[1]);
		}
	}

	return patterns;
};

const getManifestWorkspacePatterns = async (
	rootDirectory: string,
): Promise<{patterns: string[]; hasManifest: boolean}> => {
	const patterns: string[] = [];
	let hasManifest = false;

	const packageJson = await readJson(path.join(rootDirectory, 'package.json'));
	const workspaces = packageJson.workspaces;
	if (Array.isArray(workspaces)) {
		patterns.push(
			...workspaces.filter(
				(entry): entry is string => typeof entry === 'string',
			),
		);
		hasManifest = true;
	} else if (isRecord(workspaces) && Array.isArray(workspaces.packages)) {
		patterns.push(
			...workspaces.packages.filter(
				(entry): entry is string => typeof entry === 'string',
			),
		);
		hasManifest = true;
	}

	try {
		const pnpmWorkspace = await fs.readFile(
			path.join(rootDirectory, 'pnpm-workspace.yaml'),
			'utf8',
		);
		patterns.push(...parsePnpmWorkspacePatterns(pnpmWorkspace));
		hasManifest = true;
	} catch {}

	const lernaConfig = await readJson(path.join(rootDirectory, 'lerna.json'));
	if (Array.isArray(lernaConfig.packages)) {
		patterns.push(
			...lernaConfig.packages.filter(
				(entry): entry is string => typeof entry === 'string',
			),
		);
		hasManifest = true;
	}

	return {
		patterns: toUniqueNormalizedPatterns(patterns),
		hasManifest,
	};
};

const isContainedPath = (rootPath: string, targetPath: string): boolean =>
	targetPath === rootPath || targetPath.startsWith(`${rootPath}${path.sep}`);

const toContainedRealpath = async (
	rootRealpath: string,
	candidatePath: string,
): Promise<string | null> => {
	try {
		const stat = await fs.stat(candidatePath);
		if (!stat.isDirectory()) return null;
		const resolvedPath = await fs.realpath(candidatePath);
		return isContainedPath(rootRealpath, resolvedPath) ? resolvedPath : null;
	} catch {
		return null;
	}
};

const collectManifestWorkspaceDirectories = async (
	rootDirectory: string,
	manifestPatterns: readonly string[],
): Promise<string[]> => {
	if (manifestPatterns.length === 0) return [];

	const includePatterns = manifestPatterns.filter(
		pattern => !pattern.startsWith('!'),
	);
	const excludePatterns = manifestPatterns
		.filter(pattern => pattern.startsWith('!'))
		.map(pattern => pattern.slice(1));

	const discoveredDirectories = new Set<string>();
	for (const includePattern of includePatterns) {
		const directories = await expandWorkspacePattern(
			rootDirectory,
			includePattern,
		);
		for (const directory of directories) {
			discoveredDirectories.add(path.resolve(directory));
		}
	}

	if (excludePatterns.length === 0) {
		return [...discoveredDirectories];
	}

	const filtered = [...discoveredDirectories].filter(directory => {
		const relativeDirectory = toPosixPath(
			path.relative(rootDirectory, directory),
		);
		for (const excludePattern of excludePatterns) {
			if (matchesWorkspacePattern(relativeDirectory, excludePattern)) {
				return false;
			}
		}
		return true;
	});

	return filtered;
};

const collectHeuristicWorkspaceDirectories = async (
	rootDirectory: string,
): Promise<string[]> => {
	const discovered = new Set<string>();

	for (const heuristicRoot of HEURISTIC_WORKSPACE_ROOTS) {
		const absoluteRoot = path.join(rootDirectory, heuristicRoot);
		const entries = await listDirectories(absoluteRoot);
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			if (WORKSPACE_SKIP_DIRS.has(entry.name)) continue;
			const directory = path.join(absoluteRoot, entry.name);
			if (await hasPackageJson(directory)) {
				discovered.add(path.resolve(directory));
			}
		}
	}

	if (discovered.size > 0) {
		return [...discovered];
	}

	const topLevelEntries = await listDirectories(rootDirectory);
	for (const entry of topLevelEntries) {
		if (!entry.isDirectory()) continue;
		if (WORKSPACE_SKIP_DIRS.has(entry.name)) continue;
		const directory = path.join(rootDirectory, entry.name);
		if (await hasPackageJson(directory)) {
			discovered.add(path.resolve(directory));
		}
	}

	return [...discovered];
};

const discoverWorkspaceDirectoriesByMode = async (
	rootDirectory: string,
	mode: WorkspaceDiscoveryMode,
): Promise<{
	source: WorkspaceDiscoverySource;
	workspaceDirectories: string[];
	manifestPatterns: string[];
	hasManifest: boolean;
}> => {
	const manifestData = await getManifestWorkspacePatterns(rootDirectory);

	if (mode === 'manifest-only') {
		const manifestDirectories = await collectManifestWorkspaceDirectories(
			rootDirectory,
			manifestData.patterns,
		);
		return {
			source: manifestDirectories.length > 0 ? 'manifest' : 'none',
			workspaceDirectories: manifestDirectories,
			manifestPatterns: manifestData.patterns,
			hasManifest: manifestData.hasManifest,
		};
	}

	if (mode === 'heuristic-only') {
		const heuristicDirectories =
			await collectHeuristicWorkspaceDirectories(rootDirectory);
		return {
			source: heuristicDirectories.length > 0 ? 'heuristic' : 'none',
			workspaceDirectories: heuristicDirectories,
			manifestPatterns: manifestData.patterns,
			hasManifest: manifestData.hasManifest,
		};
	}

	const manifestDirectories = await collectManifestWorkspaceDirectories(
		rootDirectory,
		manifestData.patterns,
	);
	if (manifestDirectories.length > 0) {
		return {
			source: 'manifest',
			workspaceDirectories: manifestDirectories,
			manifestPatterns: manifestData.patterns,
			hasManifest: manifestData.hasManifest,
		};
	}

	const heuristicDirectories =
		await collectHeuristicWorkspaceDirectories(rootDirectory);
	return {
		source: heuristicDirectories.length > 0 ? 'heuristic' : 'none',
		workspaceDirectories: heuristicDirectories,
		manifestPatterns: manifestData.patterns,
		hasManifest: manifestData.hasManifest,
	};
};

export const discoverWorkspaces = async (
	rootDirectory: string,
	mode: WorkspaceDiscoveryMode = 'manifest-fallback',
): Promise<WorkspaceDiscoveryResult> => {
	const resolvedRootDirectory = path.resolve(rootDirectory);
	const rootRealpath = await fs
		.realpath(resolvedRootDirectory)
		.catch(() => resolvedRootDirectory);

	const discovered = await discoverWorkspaceDirectoriesByMode(
		resolvedRootDirectory,
		mode,
	);

	const uniqueDirectories = new Set<string>();
	for (const directory of discovered.workspaceDirectories) {
		const containedPath = await toContainedRealpath(rootRealpath, directory);
		if (!containedPath) continue;
		if (containedPath === rootRealpath) continue;
		uniqueDirectories.add(containedPath);
	}

	return {
		rootDirectory: rootRealpath,
		workspaceDirectories: [...uniqueDirectories].sort((left, right) =>
			left.localeCompare(right),
		),
		source: discovered.source,
		manifestPatterns: discovered.manifestPatterns,
		hasManifest: discovered.hasManifest,
	};
};
