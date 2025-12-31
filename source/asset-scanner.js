import path from 'node:path';
import fs from 'node:fs/promises';

const IMAGE_EXTENSIONS = new Set([
	'.png',
	'.jpg',
	'.jpeg',
	'.gif',
	'.svg',
	'.webp',
	'.avif',
	'.ico',
	'.bmp',
]);

const SOURCE_EXTENSIONS = new Set([
	'.js',
	'.jsx',
	'.ts',
	'.tsx',
	'.css',
	'.scss',
	'.sass',
	'.less',
	'.html',
	'.md',
	'.mdx',
]);

async function* walkFiles(dir, extensions) {
	let entries = [];
	try {
		entries = await fs.readdir(dir, {withFileTypes: true});
	} catch {
		return;
	}

	for (const entry of entries) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			yield* walkFiles(full, extensions);
		} else if (entry.isFile()) {
			const ext = path.extname(entry.name).toLowerCase();
			if (!extensions || extensions.has(ext)) {
				yield full;
			}
		}
	}
}

export const findUnusedAssets = async cwd => {
	const publicDir = path.join(cwd, 'public');
	try {
		await fs.access(publicDir);
	} catch {
		return []; // No public dir
	}

	// 1. Gather all assets in public/
	const assets = [];
	for await (const p of walkFiles(publicDir, IMAGE_EXTENSIONS)) {
		assets.push(p);
	}

	if (assets.length === 0) return [];

	// 2. Gather all source files
	const sourceFiles = [];
	const srcDirs = ['src', 'app', 'pages', 'components', 'lib', 'utils', 'hooks'];
	// Also check root files
	const rootFiles = await fs.readdir(cwd);
	for (const f of rootFiles) {
		if (SOURCE_EXTENSIONS.has(path.extname(f))) {
			sourceFiles.push(path.join(cwd, f));
		}
	}

	for (const dir of srcDirs) {
		const fullDir = path.join(cwd, dir);
		try {
			await fs.access(fullDir);
			for await (const p of walkFiles(fullDir, SOURCE_EXTENSIONS)) {
				sourceFiles.push(p);
			}
		} catch {
			// ignore missing dirs
		}
	}

	// 3. Read source files content
	const contents = await Promise.all(
		sourceFiles.map(async f => {
			try {
				return await fs.readFile(f, 'utf8');
			} catch {
				return '';
			}
		}),
	);
	const fullSource = contents.join('\n');

	// 4. Check for usage
	const unused = [];
	for (const asset of assets) {
		const filename = path.basename(asset);
		const relPath = path.relative(publicDir, asset); // e.g. "images/logo.png"
		
		// Naive check: does the filename appear?
		// Or the relative path?
		// We check both "logo.png" and "images/logo.png"
		
		const nameMatch = fullSource.includes(filename);
		// For relative path, we need to be careful about slashes.
		// In code it might be "/images/logo.png"
		const relMatch = fullSource.includes(relPath) || fullSource.includes('/' + relPath);

		if (!nameMatch && !relMatch) {
			unused.push(asset);
		}
	}

	return unused;
};
