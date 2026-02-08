import fs from 'node:fs/promises';
import type {Dirent} from 'node:fs';
import path from 'node:path';
import type {AssetScannerOptions} from './types.js';
import {DEFAULT_SCAN_SKIP_DIRS} from './scanner.js';

export const IMAGE_EXTENSIONS = new Set([
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

export const SOURCE_EXTENSIONS = new Set([
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

export const DEFAULT_SOURCE_DIRS = [
	'src',
	'app',
	'pages',
	'components',
	'lib',
	'utils',
	'hooks',
] as const;

export const DEFAULT_SOURCE_SKIP_DIRS = new Set([
	...DEFAULT_SCAN_SKIP_DIRS,
	'public',
	'dist',
	'build',
	'out',
]);

interface AssetCandidate {
	fullPath: string;
	filename: string;
	relativePath: string;
}

const walkFiles = async function* (
	directory: string,
	fileExtensions: Set<string>,
	skipDirs: Set<string>,
): AsyncGenerator<string> {
	let entries: Dirent[];
	try {
		entries = await fs.readdir(directory, {withFileTypes: true});
	} catch {
		return;
	}

	for (const entry of entries) {
		const absolutePath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			if (skipDirs.has(entry.name)) continue;
			yield* walkFiles(absolutePath, fileExtensions, skipDirs);
			continue;
		}

		if (!entry.isFile()) continue;
		const extension = path.extname(entry.name).toLowerCase();
		if (fileExtensions.has(extension)) {
			yield absolutePath;
		}
	}
};

const directoryExists = async (directory: string): Promise<boolean> => {
	try {
		const stat = await fs.stat(directory);
		return stat.isDirectory();
	} catch {
		return false;
	}
};

const collectSourceFiles = async (
	cwd: string,
	sourceDirectories: readonly string[],
	skipDirs: Set<string>,
): Promise<string[]> => {
	const sourceFiles = new Set<string>();

	// Root-level source files can contain asset references (e.g. next.config.ts).
	try {
		const rootEntries = await fs.readdir(cwd, {withFileTypes: true});
		for (const entry of rootEntries) {
			if (!entry.isFile()) continue;
			const extension = path.extname(entry.name).toLowerCase();
			if (SOURCE_EXTENSIONS.has(extension)) {
				sourceFiles.add(path.join(cwd, entry.name));
			}
		}
	} catch {}

	for (const sourceDirectory of sourceDirectories) {
		const absoluteSourceDirectory = path.join(cwd, sourceDirectory);
		// eslint-disable-next-line no-await-in-loop
		if (!(await directoryExists(absoluteSourceDirectory))) continue;

		// eslint-disable-next-line no-await-in-loop
		for await (const filePath of walkFiles(
			absoluteSourceDirectory,
			SOURCE_EXTENSIONS,
			skipDirs,
		)) {
			sourceFiles.add(filePath);
		}
	}

	return [...sourceFiles];
};

export const findUnusedAssets = async (
	cwd: string,
	options: AssetScannerOptions = {},
): Promise<string[]> => {
	const publicDirectory = path.join(cwd, 'public');
	if (!(await directoryExists(publicDirectory))) {
		return [];
	}

	const skipDirs = new Set(DEFAULT_SOURCE_SKIP_DIRS);
	for (const skipDir of options.skipDirs ?? []) {
		if (typeof skipDir === 'string' && skipDir.length > 0) {
			skipDirs.add(skipDir);
		}
	}

	const assets: AssetCandidate[] = [];
	for await (const filePath of walkFiles(
		publicDirectory,
		IMAGE_EXTENSIONS,
		skipDirs,
	)) {
		assets.push({
			fullPath: filePath,
			filename: path.basename(filePath),
			relativePath: path
				.relative(publicDirectory, filePath)
				.split(path.sep)
				.join('/'),
		});
	}

	if (assets.length === 0) return [];

	const basenameCounts = new Map<string, number>();
	for (const asset of assets) {
		basenameCounts.set(
			asset.filename,
			(basenameCounts.get(asset.filename) ?? 0) + 1,
		);
	}

	const sourceDirectories = options.sourceDirectories?.length
		? options.sourceDirectories
		: [...DEFAULT_SOURCE_DIRS];
	const sourceFiles = await collectSourceFiles(
		cwd,
		sourceDirectories,
		skipDirs,
	);

	const unresolved = new Set(assets.keys());

	for (const sourceFile of sourceFiles) {
		if (unresolved.size === 0) break;

		let content = '';
		try {
			// eslint-disable-next-line no-await-in-loop
			content = await fs.readFile(sourceFile, 'utf8');
		} catch {
			continue;
		}

		for (const index of unresolved) {
			const asset = assets[index];
			if (
				content.includes(asset.relativePath) ||
				content.includes(`/${asset.relativePath}`)
			) {
				unresolved.delete(index);
				continue;
			}

			const isUniqueBasename = basenameCounts.get(asset.filename) === 1;
			if (isUniqueBasename && content.includes(asset.filename)) {
				unresolved.delete(index);
			}
		}
	}

	return [...unresolved].map(index => assets[index].fullPath);
};
