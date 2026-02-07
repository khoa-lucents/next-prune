import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import test from 'ava';
import {scanArtifacts, human} from './source/scanner.js';

const pathExists = async targetPath => {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
};

test('scanner finds .next and node_modules/.cache/next', async t => {
	const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-'));
	const appDir = path.join(temporaryDir, 'app');
	await fs.mkdir(path.join(appDir, '.next'), {recursive: true});
	await fs.mkdir(path.join(appDir, 'node_modules/.cache/next'), {
		recursive: true,
	});

	const items = await scanArtifacts(appDir);
	const sorted = items.map(i => path.relative(appDir, i.path)).sort();

	// Expect both cache locations to be discovered
	t.deepEqual(
		sorted,
		['.next', path.join('node_modules', '.cache', 'next')].sort(),
	);

	// Human formatter returns a string with unit
	t.regex(human(1024), /KB$/);
});

test('scanner finds custom distDir from next.config', async t => {
	const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-'));
	const appDir = path.join(temporaryDir, 'app');
	await fs.mkdir(path.join(appDir, 'build-output'), {recursive: true});
	await fs.writeFile(
		path.join(appDir, 'next.config.js'),
		"module.exports = { distDir: 'build-output' };\n",
	);

	const items = await scanArtifacts(appDir);
	const sorted = items.map(i => path.relative(appDir, i.path)).sort();

	t.deepEqual(sorted, ['build-output']);
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

test('cli config neverDelete matches cross-platform path separators', async t => {
	const execFileAsync = promisify(execFile);

	const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-'));
	const appDir = path.join(temporaryDir, 'app');
	await fs.mkdir(path.join(appDir, '.next'), {recursive: true});
	await fs.mkdir(path.join(appDir, 'node_modules/.cache/next'), {
		recursive: true,
	});
	await fs.writeFile(
		path.join(appDir, '.next-prunerc.json'),
		JSON.stringify({neverDelete: [String.raw`node_modules\.cache`]}),
	);

	const {stdout} = await execFileAsync(
		process.execPath,
		['source/cli.js', '--json', `--cwd=${appDir}`],
		{cwd: process.cwd()},
	);

	const data = JSON.parse(stdout);
	const relativePaths = new Set(
		data.map(item => path.relative(appDir, item.path)),
	);
	t.false(relativePaths.has(path.join('node_modules', '.cache', 'next')));
	t.true(relativePaths.has('.next'));
});

test('cli --yes deletes artifacts in non-interactive mode', async t => {
	const execFileAsync = promisify(execFile);

	const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-'));
	const appDir = path.join(temporaryDir, 'app');
	const nextDir = path.join(appDir, '.next');
	const cacheDir = path.join(appDir, 'node_modules/.cache/next');

	await fs.mkdir(nextDir, {recursive: true});
	await fs.mkdir(cacheDir, {recursive: true});

	const {stdout} = await execFileAsync(
		process.execPath,
		['source/cli.js', '--yes', `--cwd=${appDir}`],
		{cwd: process.cwd()},
	);

	t.true(stdout.includes('Deleted'));
	t.false(await pathExists(nextDir));
	t.false(await pathExists(cacheDir));
});

test('cli --yes --dry-run does not delete artifacts', async t => {
	const execFileAsync = promisify(execFile);

	const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-'));
	const appDir = path.join(temporaryDir, 'app');
	const nextDir = path.join(appDir, '.next');

	await fs.mkdir(nextDir, {recursive: true});

	const {stdout} = await execFileAsync(
		process.execPath,
		['source/cli.js', '--yes', '--dry-run', `--cwd=${appDir}`],
		{cwd: process.cwd()},
	);

	t.true(stdout.includes('Dry-run'));
	t.true(await pathExists(nextDir));
});
