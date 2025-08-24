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
const CACHE_PATTERNS = [
	'.next',                    // Next.js build output and cache
	'out',                      // Next.js static export output
	'.vercel/output',           // Vercel Build Output API bundle
	'.turbo',                   // Turborepo cache
	'.vercel_build_output',     // Legacy Vercel build output
	'node_modules/.cache/next', // Next.js cache in node_modules
];

const SKIP_DIRS = new Set([
	'.git',
	'node_modules',
	'dist',
	'build',
	'coverage',
	...CACHE_PATTERNS,
]);

export const human = bytes => {
	if (!bytes) return '0 B';
	const units = ['B', 'KB', 'MB', 'GB', 'TB'];
	const i = Math.floor(Math.log(bytes) / Math.log(1024));
	const value = bytes / 1024 ** i;
	return `${value.toFixed(value >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
};

export const dirExists = async p => {
	try {
		const s = await fs.stat(p);
		return s.isDirectory();
	} catch {
		return false;
	}
};

export async function* walk(root) {
	let entries = [];
	try {
		entries = await fs.readdir(root, {withFileTypes: true});
	} catch {
		return;
	}

	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const full = path.join(root, entry.name);
		yield full;
		if (SKIP_DIRS.has(entry.name)) continue;
		yield* walk(full);
	}
}

export const findNextCaches = async cwd => {
	const results = [];

	// Check for build artifacts in the root directory
	for (const pattern of CACHE_PATTERNS) {
		const fullPath = path.join(cwd, pattern);
		if (await dirExists(fullPath)) {
			results.push(fullPath);
		}
	}

	// Walk subdirectories to find nested artifacts
	for await (const dir of walk(cwd)) {
		const base = path.basename(dir);
		const relativePath = path.relative(cwd, dir);
		
		// Check if this directory matches any of our patterns
		if (CACHE_PATTERNS.includes(base)) {
			results.push(dir);
			continue;
		}
		
		// Special handling for nested patterns like .vercel/output
		for (const pattern of CACHE_PATTERNS) {
			if (pattern.includes('/') && relativePath === pattern) {
				results.push(dir);
				break;
			}
		}

		// Special case for node_modules/.cache/next
		if (base === 'node_modules') {
			const maybe = path.join(dir, '.cache', 'next');
			if (await dirExists(maybe)) results.push(maybe);
		}
	}

	return [...new Set(results)];
};

export const getDirSize = async dir => {
	let total = 0;

	const processDir = async d => {
		let entries = [];
		try {
			entries = await fs.readdir(d, {withFileTypes: true});
		} catch {
			return 0;
		}

		const paths = entries.map(entry => path.join(d, entry.name));
		const stats = await Promise.all(
			paths.map(p => fs.lstat(p).catch(() => undefined)),
		);

		let sizeHere = 0;
		const subdirs = [];
		for (const [i, st] of stats.entries()) {
			if (!st) continue;
			if (st.isSymbolicLink()) continue;
			if (st.isDirectory()) subdirs.push(paths[i]);
			else sizeHere += st.size;
		}

		const subSizes = await Promise.all(subdirs.map(d2 => processDir(d2)));
		for (const s of subSizes) sizeHere += s;
		return sizeHere;
	};

	total = await processDir(dir);
	return total;
};

export const scanWithSizes = async cwd => {
	const paths = await findNextCaches(cwd);
	const sizes = await Promise.all(paths.map(p => getDirSize(p)));
	const items = [];
	for (let i = 0; i < paths.length; i += 1)
		items.push({path: paths[i], size: sizes[i]});
	return items;
};
