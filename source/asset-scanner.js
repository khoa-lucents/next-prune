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

const collectSourceFilesInDir = async directoryPath => {
	try {
		await fs.access(directoryPath);
	} catch {
		return [];
	}

	const files = [];
	for await (const filePath of walkFiles(directoryPath, SOURCE_EXTENSIONS)) {
		files.push(filePath);
	}

	return files;
};

export const findUnusedAssets = async cwd => {
	const publicDir = path.join(cwd, 'public');
	try {
		await fs.access(publicDir);
	} catch {
		return []; // No public dir
	}

	// 1. Gather all assets in public/
	const assets = []; // { fullPath, filename, relPath }
	for await (const p of walkFiles(publicDir, IMAGE_EXTENSIONS)) {
		assets.push({
			fullPath: p,
			filename: path.basename(p),
			relPath: path.relative(publicDir, p).split(path.sep).join('/'),
		});
	}

	if (assets.length === 0) return [];

	// 2. Gather all source files
	const sourceFiles = [];
	const srcDirs = [
		'src',
		'app',
		'pages',
		'components',
		'lib',
		'utils',
		'hooks',
	];

	// Check root files
	try {
		const rootFiles = await fs.readdir(cwd);
		for (const f of rootFiles) {
			if (SOURCE_EXTENSIONS.has(path.extname(f).toLowerCase())) {
				sourceFiles.push(path.join(cwd, f));
			}
		}
	} catch {}

	const sourceFilesByDirectory = await Promise.all(
		srcDirs.map(async dirName =>
			collectSourceFilesInDir(path.join(cwd, dirName)),
		),
	);
	sourceFiles.push(...sourceFilesByDirectory.flat());

	// 3. Check usage by streaming files
	// We keep a set of indices of assets that are NOT yet found.
	// Initially all assets are candidates.
	const candidateIndices = new Set(assets.keys());

	for (const file of sourceFiles) {
		if (candidateIndices.size === 0) break; // All found

		try {
			// eslint-disable-next-line no-await-in-loop
			const content = await fs.readFile(file, 'utf8');

			for (const index of candidateIndices) {
				const asset = assets[index];
				// Naive check: filename or relative path
				// We check "logo.png" or "images/logo.png"
				// Also check with leading slash for paths like "/images/logo.png"

				const nameMatch = content.includes(asset.filename);
				if (nameMatch) {
					candidateIndices.delete(index);
					continue;
				}

				const relMatch =
					content.includes(asset.relPath) ||
					content.includes('/' + asset.relPath);
				if (relMatch) {
					candidateIndices.delete(index);
				}
			}
		} catch {
			// ignore read errors
		}
	}

	// 4. Return remaining candidates (unused)
	return [...candidateIndices].map(i => assets[i].fullPath);
};
