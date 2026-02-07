import path from 'node:path';
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';

const execFileAsync = promisify(execFile);

// Patterns for Next.js and related build artifacts/caches
const ARTIFACT_NAMES = new Set([
	'.next',
	'out',
	'.turbo',
	'.vercel_build_output',
	'coverage',
	'.swc',
	'.docusaurus',
	'storybook-static',
]);

// Directories to skip walking into
const SKIP_DIRS = new Set([
	'.git',
	'node_modules',
	'dist',
	'build',
	'.next',
	'.turbo',
	'.vercel',
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
];
const NEXT_CONFIG_FILE_SET = new Set(NEXT_CONFIG_FILES);

const DIST_DIR_PATTERN = /\bdistDir\s*:\s*(['"`])([^'"`]+)\1/;

const stripJavaScriptComments = source =>
	source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/.*$/gm, '');

const normalizeRelativeDir = value => {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (!trimmed) return null;
	const normalized = path.normalize(trimmed);
	if (!normalized || normalized === '.') return null;
	if (path.isAbsolute(normalized)) return null;
	const parts = normalized.split(path.sep);
	if (parts.includes('..')) return null;
	return normalized;
};

const findNextConfigFile = entries => {
	for (const entry of entries) {
		if (NEXT_CONFIG_FILE_SET.has(entry.name)) {
			return entry.name;
		}
	}

	return null;
};

const getCustomNextArtifact = async (dir, entries) => {
	const configName = findNextConfigFile(entries);
	if (!configName) return null;

	try {
		const configPath = path.join(dir, configName);
		const configSource = await fs.readFile(configPath, 'utf8');
		const sanitizedConfig = stripJavaScriptComments(configSource);
		const match = DIST_DIR_PATTERN.exec(sanitizedConfig);
		if (!match || !match[2]) return null;

		const relativeDistDir = normalizeRelativeDir(match[2]);
		if (!relativeDistDir) return null;

		const fullPath = path.join(dir, relativeDistDir);
		const stat = await fs.stat(fullPath);
		if (!stat.isDirectory()) return null;

		return {
			fullPath,
			topLevelName: relativeDistDir.split(path.sep)[0],
		};
	} catch {
		return null;
	}
};

export const human = bytes => {
	if (bytes === 0) return '0 B';
	if (!bytes) return '-';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const value = bytes / 1024 ** i;
	return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};

export const timeAgo = date => {
	if (!date) return '';
	const seconds = Math.floor((Date.now() - date) / 1000);
	let interval = seconds / 31_536_000;
	if (interval > 1) return Math.floor(interval) + 'y ago';
	interval = seconds / 2_592_000;
	if (interval > 1) return Math.floor(interval) + 'mo ago';
	interval = seconds / 86_400;
	if (interval > 1) return Math.floor(interval) + 'd ago';
	interval = seconds / 3600;
	if (interval > 1) return Math.floor(interval) + 'h ago';
	interval = seconds / 60;
	if (interval > 1) return Math.floor(interval) + 'm ago';
	return Math.floor(seconds) + 's ago';
};

const getNativeSize = async p => {
	if (os.platform() === 'win32') return null;
	try {
		// Du -sk returns size in 1024-byte blocks.
		const {stdout} = await execFileAsync('du', ['-sk', p]);
		const match = /^(\d+)\s/.exec(stdout);
		if (match && match[1]) {
			return Number.parseInt(match[1], 10) * 1024;
		}

		return null;
	} catch {
		return null;
	}
};

const walkStats = async target => {
	try {
		const stat = await fs.lstat(target);
		if (!stat.isDirectory()) {
			return {
				size: stat.size,
				fileCount: 1,
				latestMtime: stat.mtime,
			};
		}

		let entries = [];
		try {
			entries = await fs.readdir(target, {withFileTypes: true});
		} catch {
			return {
				size: 0,
				fileCount: 0,
				latestMtime: stat.mtime,
			};
		}

		const nestedStats = await Promise.all(
			entries.map(async entry => walkStats(path.join(target, entry.name))),
		);

		let size = 0;
		let fileCount = 0;
		let latestMtime = stat.mtime;
		for (const entryStats of nestedStats) {
			size += entryStats.size;
			fileCount += entryStats.fileCount;
			if (entryStats.latestMtime > latestMtime) {
				latestMtime = entryStats.latestMtime;
			}
		}

		return {size, fileCount, latestMtime};
	} catch {
		return {
			size: 0,
			fileCount: 0,
			latestMtime: new Date(0),
		};
	}
};

const getRecursiveStatsNode = async p => {
	const stats = await walkStats(p);
	return {
		size: stats.size,
		mtime: stats.latestMtime,
		fileCount: stats.fileCount,
		isDirectory: true,
	};
};

export const getArtifactStats = async p => {
	try {
		const stat = await fs.lstat(p);
		// If it's a file, just return stats
		if (!stat.isDirectory()) {
			return {
				size: stat.size,
				mtime: stat.mtime,
				fileCount: 1,
				isDirectory: false,
			};
		}

		// Try native du first for speed
		const nativeSize = await getNativeSize(p);
		if (nativeSize !== null) {
			return {
				size: nativeSize,
				mtime: stat.mtime, // Approximate mtime of root folder
				fileCount: 0, // We skip counting files for speed if using du
				isDirectory: true,
			};
		}

		// Fallback to node
		return await getRecursiveStatsNode(p);
	} catch {
		return {size: 0, mtime: new Date(), fileCount: 0, isDirectory: false};
	}
};

const findNodeModulesCacheArtifacts = async nodeModulesPath => {
	const cachePath = path.join(nodeModulesPath, '.cache');
	try {
		const cacheEntries = await fs.readdir(cachePath, {withFileTypes: true});
		const artifacts = [];
		for (const entry of cacheEntries) {
			if (
				entry.isDirectory() &&
				(entry.name === 'next' || entry.name === 'turbopack')
			) {
				artifacts.push(path.join(cachePath, entry.name));
			}
		}

		return artifacts;
	} catch {
		return [];
	}
};

const findVercelOutputArtifact = async vercelPath => {
	const outputPath = path.join(vercelPath, 'output');
	try {
		const stat = await fs.stat(outputPath);
		return stat.isDirectory() ? outputPath : null;
	} catch {
		return null;
	}
};

export const scanArtifacts = async cwd => {
	const results = new Set();
	const processed = new Set();

	const scanDirectory = async dir => {
		if (processed.has(dir)) return;
		processed.add(dir);

		let entries = [];
		try {
			entries = await fs.readdir(dir, {withFileTypes: true});
		} catch {
			return;
		}

		const customNextArtifact = await getCustomNextArtifact(dir, entries);
		if (customNextArtifact) {
			results.add(customNextArtifact.fullPath);
		}

		const nextDirectories = [];
		const specialCheckPromises = [];

		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const fullPath = path.join(dir, entry.name);

			if (customNextArtifact?.topLevelName === entry.name) {
				continue;
			}

			if (ARTIFACT_NAMES.has(entry.name)) {
				results.add(fullPath);
				continue;
			}

			if (entry.name === 'node_modules') {
				specialCheckPromises.push(
					(async () => {
						const artifactPaths = await findNodeModulesCacheArtifacts(fullPath);
						for (const artifactPath of artifactPaths) {
							results.add(artifactPath);
						}
					})(),
				);
				continue;
			}

			if (entry.name === '.vercel') {
				specialCheckPromises.push(
					(async () => {
						const outputPath = await findVercelOutputArtifact(fullPath);
						if (outputPath) {
							results.add(outputPath);
						}
					})(),
				);
				continue;
			}

			if (SKIP_DIRS.has(entry.name)) {
				continue;
			}

			nextDirectories.push(fullPath);
		}

		await Promise.all(specialCheckPromises);

		await Promise.all(
			nextDirectories.map(async nextDirectory => scanDirectory(nextDirectory)),
		);
	};

	await scanDirectory(cwd);

	// Calculate stats in parallel with a concurrency limit
	// (Promise.all is uncapped, but usually OS file limits are high enough for this list size)
	const paths = [...results];
	const stats = await Promise.all(
		paths.map(async p => {
			const s = await getArtifactStats(p);
			return {path: p, ...s};
		}),
	);

	return stats.sort((a, b) => b.size - a.size);
};
