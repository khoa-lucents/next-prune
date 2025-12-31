#!/usr/bin/env node
import process from 'node:process';
import path from 'node:path';
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

async function main() {
	const config = await loadConfig(props.cwd);

	if (cli.flags.list || cli.flags.json) {
		let items = await scanArtifacts(props.cwd);

		if (config.checkUnusedAssets) {
			const assetPaths = await findUnusedAssets(props.cwd);
			const assetStats = await Promise.all(
				assetPaths.map(p => getArtifactStats(p)),
			);
			const assetItems = assetPaths.map((p, i) => ({
				path: p,
				...assetStats[i],
				type: 'asset',
			}));
			items = [...items, ...assetItems];
			items.sort((a, b) => b.size - a.size);
		}

		// Filter out neverDelete items
		if (config.neverDelete.length > 0) {
			items = items.filter(it => {
				const rel = path.relative(props.cwd, it.path);
				return !config.neverDelete.some(
					pattern => rel === pattern || rel.startsWith(pattern + path.sep),
				);
			});
		}

		if (cli.flags.json) {
			process.stdout.write(JSON.stringify(items, null, 2) + '\n');
			return;
		}

		let total = 0;
		for (const it of items) total += typeof it.size === 'number' ? it.size : 0;
		for (const it of items) {
			const rel = path.relative(props.cwd, it.path) || '.';
			const time = it.mtime ? `(${timeAgo(it.mtime)})` : '';
			const type = it.type === 'asset' ? '⚠️ ' : '';
			const icon = it.isDirectory === false ? '📄' : '📁';
			process.stdout.write(
				`${human(it.size).padStart(6)}  ${time.padEnd(10)} ${type}${icon} ${rel}\n`,
			);
		}

		process.stdout.write(`\nTotal: ${human(total)} in ${items.length} items\n`);
		return;
	}

	const reactModule = await import('react');
	const React = reactModule.default;
	const ink = await import('ink');
	const {render} = ink;
	const {default: App} = await import('./app.js');
	render(React.createElement(App, {...props, config}));
}

// eslint-disable-next-line unicorn/prefer-top-level-await
main();
