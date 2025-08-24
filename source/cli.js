#!/usr/bin/env node
import process from 'node:process';
import path from 'node:path';
import meow from 'meow';
import {scanWithSizes, human} from './scanner.js';

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
	if (cli.flags.list || cli.flags.json) {
		const items = await scanWithSizes(props.cwd);
		if (cli.flags.json) {
			process.stdout.write(JSON.stringify(items, null, 2) + '\n');
			return;
		}

		let total = 0;
		for (const it of items) total += typeof it.size === 'number' ? it.size : 0;
		for (const it of items) {
			const rel = path.relative(props.cwd, it.path) || '.';
			process.stdout.write(`${human(it.size).padStart(6)}  ${rel}\n`);
		}

		process.stdout.write(
			`\nTotal: ${human(total)} in ${items.length} directorie${
				items.length === 1 ? '' : 's'
			}\n`,
		);
		return;
	}

	const reactModule = await import('react');
	const React = reactModule.default;
	const ink = await import('ink');
	const {render} = ink;
	const {default: App} = await import('./app.js');
	render(React.createElement(App, props));
}

// eslint-disable-next-line unicorn/prefer-top-level-await
main();
