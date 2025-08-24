import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import test from 'ava';
import {scanWithSizes, human} from './source/scanner.js';

test('scanner finds .next and node_modules/.cache/next', async t => {
	const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-'));
	const appDir = path.join(temporaryDir, 'app');
	await fs.mkdir(path.join(appDir, '.next'), {recursive: true});
	await fs.mkdir(path.join(appDir, 'node_modules/.cache/next'), {
		recursive: true,
	});

	const items = await scanWithSizes(appDir);
	const sorted = items.map(i => path.relative(appDir, i.path)).sort();

	// Expect both cache locations to be discovered
	t.deepEqual(
		sorted,
		['.next', path.join('node_modules', '.cache', 'next')].sort(),
	);

	// Human formatter returns a string with unit
	t.regex(human(1024), /KB$/);
});

test('cli --json returns structured results', async t => {
	const execFileAsync = promisify(execFile);

	const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-'));
	const appDir = path.join(temporaryDir, 'app');
	await fs.mkdir(path.join(appDir, '.next'), {recursive: true});

	const {stdout} = await execFileAsync(
		process.execPath,
		['source/cli.js', '--json', `--cwd=${appDir}`],
		{cwd: process.cwd()},
	);

	const data = JSON.parse(stdout);
	t.true(Array.isArray(data));
	t.true(data.length > 0);
	t.true(typeof data[0].path === 'string');
	t.true(typeof data[0].size === 'number');
});

test('cli --list prints human output', async t => {
	const execFileAsync = promisify(execFile);

	const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-'));
	const appDir = path.join(temporaryDir, 'app');
	await fs.mkdir(path.join(appDir, 'node_modules/.cache/next'), {
		recursive: true,
	});

	const {stdout} = await execFileAsync(
		process.execPath,
		['source/cli.js', '--list', `--cwd=${appDir}`],
		{cwd: process.cwd()},
	);

	t.true(stdout.includes('Total:'));
});
