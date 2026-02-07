#!/usr/bin/env node
import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs/promises';
import meow from 'meow';
import {scanArtifacts, getArtifactStats, human, timeAgo} from './scanner.js';
import {findUnusedAssets} from './asset-scanner.js';
import {loadConfig} from './config.js';

const cli = meow(
	`
	Usage
	  $ next-prune [options]

	Description
	  Scan for Next.js build artifacts (.next, out), Vercel outputs (.vercel/output), 
	  Turborepo caches (.turbo), and other safe-to-delete directories.

	Options
	  --yes, -y     Skip confirmation and delete selected immediately
	  --dry-run      Don't delete anything; just show results
	  --cwd=<path>   Directory to scan (default: current working dir)
	  --list         Non-interactive list of artifacts and sizes, then exit
	  --json         Output JSON (implies --list)

	Examples
	  $ next-prune
	  $ next-prune --dry-run
	  $ next-prune -y --cwd=./packages
	`,
	{
		importMeta: import.meta,
		flags: {
			yes: {
				type: 'boolean',
				shortFlag: 'y',
				default: false,
			},
			dryRun: {
				type: 'boolean',
				default: false,
			},
			cwd: {
				type: 'string',
			},
			list: {
				type: 'boolean',
				default: false,
			},
			json: {
				type: 'boolean',
				default: false,
			},
		},
	},
);

const props = {
	confirmImmediately: Boolean(cli.flags.yes),
	dryRun: Boolean(cli.flags.dryRun),
	cwd: cli.flags.cwd ?? process.cwd(),
};

const toPosixPath = value => value.split(path.sep).join('/');

const matchesConfigPath = (relPath, pattern) => {
	const rel = toPosixPath(relPath);
	const normalizedPattern = String(pattern).replaceAll('\\', '/');
	return rel === normalizedPattern || rel.startsWith(`${normalizedPattern}/`);
};

const filterNeverDelete = (items, cwd, neverDelete) => {
	if (!Array.isArray(neverDelete) || neverDelete.length === 0) return items;

	return items.filter(it => {
		const rel = path.relative(cwd, it.path);
		return !neverDelete.some(pattern => matchesConfigPath(rel, pattern));
	});
};

const collectItems = async (cwd, config) => {
	let items = await scanArtifacts(cwd);

	if (config.checkUnusedAssets) {
		const assetPaths = await findUnusedAssets(cwd);
		const assetStats = await Promise.all(
			assetPaths.map(p => getArtifactStats(p)),
		);
		const assetItems = assetPaths.map((p, i) => ({
			path: p,
			...assetStats[i],
			type: 'asset',
		}));
		items = [...items, ...assetItems];
	}

	items = filterNeverDelete(items, cwd, config.neverDelete);
	items.sort((a, b) => b.size - a.size);
	return items;
};

const getTotalSize = items =>
	items.reduce(
		(total, item) => total + (typeof item.size === 'number' ? item.size : 0),
		0,
	);

const outputListResults = (items, cwd) => {
	for (const item of items) {
		const rel = path.relative(cwd, item.path) || '.';
		const time = item.mtime ? `(${timeAgo(item.mtime)})` : '';
		const type = item.type === 'asset' ? '⚠️ ' : '';
		const icon = item.isDirectory === false ? '📄' : '📁';
		process.stdout.write(
			`${human(item.size).padStart(6)}  ${time.padEnd(10)} ${type}${icon} ${rel}\n`,
		);
	}

	process.stdout.write(
		`\nTotal: ${human(getTotalSize(items))} in ${items.length} items\n`,
	);
};

const handleListMode = (items, cwd, asJson) => {
	if (asJson) {
		process.stdout.write(JSON.stringify(items, null, 2) + '\n');
		return;
	}

	outputListResults(items, cwd);
};

const removeArtifact = async item => {
	try {
		await fs.rm(item.path, {recursive: true, force: true});
		return {
			path: item.path,
			ok: true,
			size: typeof item.size === 'number' ? item.size : 0,
		};
	} catch (error) {
		return {path: item.path, ok: false, error};
	}
};

const handleYesMode = async (items, dryRun) => {
	if (items.length === 0) {
		process.stdout.write('Nothing to prune.\n');
		return;
	}

	const candidateSize = getTotalSize(items);
	if (dryRun) {
		process.stdout.write(
			`Dry-run: would delete ${items.length} items (${human(candidateSize)}).\n`,
		);
		return;
	}

	const deletionResults = await Promise.all(
		items.map(async item => removeArtifact(item)),
	);
	const failures = [];
	let deletedCount = 0;
	let reclaimedBytes = 0;
	for (const result of deletionResults) {
		if (result.ok) {
			deletedCount++;
			reclaimedBytes += result.size;
		} else {
			failures.push(result);
		}
	}

	process.stdout.write(
		`Deleted ${deletedCount}/${items.length} items. Reclaimed ${human(reclaimedBytes)}.\n`,
	);

	if (failures.length > 0) {
		for (const failure of failures) {
			process.stderr.write(
				`Failed to delete ${failure.path}: ${String(failure.error?.message ?? failure.error)}\n`,
			);
		}

		process.exitCode = 1;
	}
};

const runInteractiveMode = async config => {
	const reactModule = await import('react');
	const React = reactModule.default;
	const ink = await import('ink');
	const {render} = ink;
	const {default: App} = await import('./app.js');
	render(React.createElement(App, {...props, config}));
};

async function main() {
	const config = await loadConfig(props.cwd);
	const needsNonInteractiveScan =
		cli.flags.list || cli.flags.json || cli.flags.yes;
	const scannedItems = needsNonInteractiveScan
		? await collectItems(props.cwd, config)
		: [];

	if (cli.flags.list || cli.flags.json) {
		handleListMode(scannedItems, props.cwd, cli.flags.json);
		return;
	}

	if (cli.flags.yes) {
		await handleYesMode(scannedItems, cli.flags.dryRun);
		return;
	}

	await runInteractiveMode(config);
}

// eslint-disable-next-line unicorn/prefer-top-level-await
main();
