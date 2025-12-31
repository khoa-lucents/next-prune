import path from 'node:path';
import fs from 'node:fs/promises';

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
// Includes files (logs) and directories
const ARTIFACT_PATTERNS = [
	'.next', // Next.js build output
	'out', // Next.js static export
	'.vercel/output', // Vercel output
	'.turbo', // Turborepo cache
	'.vercel_build_output', // Legacy Vercel
	'node_modules/.cache/next', // Next.js cache
	'node_modules/.cache/turbopack', // Turbopack cache
	'coverage', // Test coverage
	'.swc', // SWC cache
	'.docusaurus', // Docusaurus cache
	'storybook-static', // Storybook build
	'npm-debug.log',
	'yarn-error.log',
	'pnpm-debug.log',
];

// Directories to skip during recursive scan to avoid performance hits
const SKIP_DIRS = new Set([
	'.git',
	'node_modules',
	'dist',
	'build', // careful: some projects use build as output, but often it's source
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
	const seconds = Math.floor((new Date() - date) / 1000);
	let interval = seconds / 31536000;
	if (interval > 1) return Math.floor(interval) + 'y ago';
	interval = seconds / 2592000;
	if (interval > 1) return Math.floor(interval) + 'mo ago';
	interval = seconds / 86400;
	if (interval > 1) return Math.floor(interval) + 'd ago';
	interval = seconds / 3600;
	if (interval > 1) return Math.floor(interval) + 'h ago';
	interval = seconds / 60;
	if (interval > 1) return Math.floor(interval) + 'm ago';
	return Math.floor(seconds) + 's ago';
};

export const pathExists = async p => {
	try {
		await fs.stat(p);
		return true;
	} catch {
		return false;
	}
};

// Recursively walk directories, yielding subdirectories
export async function* walk(root) {
	let entries = [];
	try {
		entries = await fs.readdir(root, {withFileTypes: true});
	} catch {
		return;
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		if (SKIP_DIRS.has(entry.name)) continue;

		const full = path.join(root, entry.name);
		yield full;
		yield* walk(full);
	}
}

export const findArtifacts = async cwd => {
	const results = new Set();

	// Helper to check a specific directory for patterns
	const checkDir = async dir => {
		for (const pattern of ARTIFACT_PATTERNS) {
			// Handle deep patterns like node_modules/.cache/next separately
			if (pattern.includes(path.sep) || pattern.includes('/')) continue;

			const fullPath = path.join(dir, pattern);
			if (await pathExists(fullPath)) {
				results.add(fullPath);
			}
		}
	};

	// Check root
	await checkDir(cwd);

	// Check specific nested known locations in root
	const nestedCandidates = [
		path.join(cwd, '.vercel/output'),
		path.join(cwd, 'node_modules/.cache/next'),
		path.join(cwd, 'node_modules/.cache/turbopack'),
	];
	for (const cand of nestedCandidates) {
		if (await pathExists(cand)) results.add(cand);
	}

	// Walk subdirectories (monorepo support / nested projects)
	for await (const dir of walk(cwd)) {
		await checkDir(dir);
		// Check nested in this subdir
		const nestedSub = [
			path.join(dir, '.vercel/output'),
			path.join(dir, 'node_modules/.cache/next'),
			path.join(dir, 'node_modules/.cache/turbopack'),
		];
		for (const cand of nestedSub) {
			if (await pathExists(cand)) results.add(cand);
		}
	}

	return [...results];
};

export const getArtifactStats = async p => {
	try {
		const stat = await fs.lstat(p);
		if (!stat.isDirectory()) {
			return {
				size: stat.size,
				mtime: stat.mtime,
				fileCount: 1,
				isDirectory: false,
			};
		}

		let totalSize = 0;
		let fileCount = 0;
		let latestMtime = stat.mtime;

		const processDir = async d => {
			let entries = [];
			try {
				entries = await fs.readdir(d, {withFileTypes: true});
			} catch {
				return;
			}

			const files = [];
			const dirs = [];

			for (const entry of entries) {
				const full = path.join(d, entry.name);
				if (entry.isDirectory()) {
					dirs.push(full);
				} else {
					files.push(full);
				}
			}

			// Process files in this dir
			const fileStats = await Promise.all(
				files.map(async f => {
					try {
						return await fs.lstat(f);
					} catch {
						return undefined;
					}
				}),
			);

			for (const s of fileStats) {
				if (!s) continue;
				totalSize += s.size;
				fileCount++;
				if (s.mtime > latestMtime) latestMtime = s.mtime;
			}

			// Recurse
			await Promise.all(dirs.map(sub => processDir(sub)));
		};

		await processDir(p);
		return {
			size: totalSize,
			mtime: latestMtime,
			fileCount,
			isDirectory: true,
		};
	} catch {
		return {size: 0, mtime: new Date(), fileCount: 0, isDirectory: false};
	}
};

export const scanArtifacts = async cwd => {
	const paths = await findArtifacts(cwd);
	const stats = await Promise.all(paths.map(p => getArtifactStats(p)));
	const items = [];
	for (let i = 0; i < paths.length; i += 1) {
		items.push({
			path: paths[i],
			...stats[i],
		});
	}

	// Sort by size (descending)
	return items.sort((a, b) => b.size - a.size);
};
