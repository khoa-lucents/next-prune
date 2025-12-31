import path from 'node:path';
import fs from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import os from 'node:os';

const execFileAsync = promisify(execFile);

export const FRAMES = Object.freeze([
	'⠋',
	'⠙',
	'⠹',
	'⠸',
	'⠼',
	'⠴',
	'⠦',
	'⠧',
	'⠇',
	'⠏',
]);

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
		// du -sk returns size in 1024-byte blocks
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

const getRecursiveStatsNode = async p => {
	let totalSize = 0;
	let fileCount = 0;
	let latestMtime = new Date(0);

	const queue = [p];

	// Use a limited concurrency pool for readdir/lstat
	// Since we are recursive, we'll process the queue in chunks
	while (queue.length > 0) {
		const target = queue.pop();
		try {
			const stat = await fs.lstat(target);
			if (stat.mtime > latestMtime) latestMtime = stat.mtime;

			if (stat.isDirectory()) {
				const entries = await fs.readdir(target, {withFileTypes: true});
				for (const entry of entries) {
					queue.push(path.join(target, entry.name));
				}
			} else {
				totalSize += stat.size;
				fileCount++;
			}
		} catch {
			// Ignore access errors
		}
	}

	return {
		size: totalSize,
		mtime: latestMtime,
		fileCount,
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

export const scanArtifacts = async cwd => {
	const results = new Set();
	const queue = [cwd];
	const processed = new Set();

	// BFS Walker
	while (queue.length > 0) {
		const dir = queue.shift();
		if (processed.has(dir)) continue;
		processed.add(dir);

		try {
			const entries = await fs.readdir(dir, {withFileTypes: true});
			const nextDirs = [];

			for (const entry of entries) {
				const full = path.join(dir, entry.name);

				if (entry.isDirectory()) {
					// Check direct matches
					if (ARTIFACT_NAMES.has(entry.name)) {
						results.add(full);
						// Don't traverse inside an artifact we already found
						continue;
					}

					// Check nested (deep) artifacts
					// This optimization avoids traversing deep into node_modules unless necessary
					// Logic: If dir is 'node_modules', we only look for '.cache'
					if (entry.name === 'node_modules') {
						const cachePath = path.join(full, '.cache');
						// Quickly check if .cache exists without fully walking node_modules
						try {
							const cacheStat = await fs.stat(cachePath);
							if (cacheStat.isDirectory()) {
								const cacheEntries = await fs.readdir(cachePath);
								if (cacheEntries.includes('next'))
									results.add(path.join(cachePath, 'next'));
								if (cacheEntries.includes('turbopack'))
									results.add(path.join(cachePath, 'turbopack'));
							}
						} catch {
							// ignore
						}
					} else if (entry.name === '.vercel') {
						const outPath = path.join(full, 'output');
						try {
							const outStat = await fs.stat(outPath);
							if (outStat.isDirectory()) {
								results.add(outPath);
							}
						} catch {
							// ignore
						}
					}

					// Should we recurse?
					if (!SKIP_DIRS.has(entry.name)) {
						nextDirs.push(full);
					}
				}
			}

			// Add next dirs to queue
			for (const d of nextDirs) queue.push(d);
		} catch {
			// ignore access errors
		}
	}

	// Calculate stats in parallel with a concurrency limit
	const paths = [...results];
	const stats = await Promise.all(
		paths.map(async p => {
			const s = await getArtifactStats(p);
			return {path: p, ...s};
		}),
	);

	return stats.sort((a, b) => b.size - a.size);
};
