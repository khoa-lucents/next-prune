import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {expect, test} from 'bun:test';

const execFileAsync = promisify(execFile);

const pathExists = async (targetPath: string): Promise<boolean> => {
	try {
		await fs.access(targetPath);
		return true;
	} catch {
		return false;
	}
};

const runCli = async (args: string[]) =>
	execFileAsync('bun', ['run', 'src/cli.ts', ...args], {
		cwd: process.cwd(),
	});

const toRelativePaths = (stdout: string, cwd: string): Set<string> => {
	const data = JSON.parse(stdout) as Array<{path: string}>;
	return new Set(data.map(item => path.relative(cwd, item.path)));
};

test('cli --json returns structured results', async () => {
	const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-'));
	const appDir = path.join(temporaryDir, 'app');
	await fs.mkdir(path.join(appDir, '.next'), {recursive: true});

	const {stdout} = await runCli(['--json', `--cwd=${appDir}`]);

	const data = JSON.parse(stdout) as Array<{path: string; size: number}>;
	expect(Array.isArray(data)).toBe(true);
	expect(data.length).toBeGreaterThan(0);
	expect(typeof data[0]?.path).toBe('string');
	expect(typeof data[0]?.size).toBe('number');
});

test('cli --list prints human output', async () => {
	const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-'));
	const appDir = path.join(temporaryDir, 'app');
	await fs.mkdir(path.join(appDir, 'node_modules/.cache/next'), {
		recursive: true,
	});

	const {stdout} = await runCli(['--list', `--cwd=${appDir}`]);

	expect(stdout.includes('Total:')).toBe(true);
});

test('cli config neverDelete matches cross-platform path separators', async () => {
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

	const {stdout} = await runCli(['--json', `--cwd=${appDir}`]);

	const relativePaths = toRelativePaths(stdout, appDir);

	expect(relativePaths.has(path.join('node_modules', '.cache', 'next'))).toBe(
		false,
	);
	expect(relativePaths.has('.next')).toBe(true);
});

test('cli --yes deletes safe artifacts in non-interactive mode', async () => {
	const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-'));
	const appDir = path.join(temporaryDir, 'app');
	const nextDir = path.join(appDir, '.next');

	await fs.mkdir(nextDir, {recursive: true});

	const {stdout} = await runCli(['--yes', `--cwd=${appDir}`]);

	expect(stdout.includes('Deleted')).toBe(true);
	expect(await pathExists(nextDir)).toBe(false);
});

test('cli --yes refuses node_modules/pm-cache deletion without --apply', async () => {
	const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-'));
	const appDir = path.join(temporaryDir, 'app');
	const cacheDir = path.join(appDir, 'node_modules/.cache/next');

	await fs.mkdir(cacheDir, {recursive: true});

	let failure:
		| {
				stderr?: string;
				code?: number;
		  }
		| undefined;

	try {
		await runCli(['--yes', `--cwd=${appDir}`]);
	} catch (error) {
		failure = error as {stderr?: string; code?: number};
	}

	expect(failure).toBeDefined();
	expect(failure?.code).toBe(1);
	expect(String(failure?.stderr)).toContain('--apply');
	expect(await pathExists(cacheDir)).toBe(true);
});

test('cli --yes --apply deletes node_modules/pm-cache candidates', async () => {
	const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-'));
	const appDir = path.join(temporaryDir, 'app');
	const cacheDir = path.join(appDir, 'node_modules/.cache/next');

	await fs.mkdir(cacheDir, {recursive: true});

	const {stdout} = await runCli(['--yes', '--apply', `--cwd=${appDir}`]);

	expect(stdout.includes('Deleted')).toBe(true);
	expect(await pathExists(cacheDir)).toBe(false);
});

test('cli --yes --no-node-modules skips node_modules candidates without --apply', async () => {
	const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-'));
	const appDir = path.join(temporaryDir, 'app');
	const nextDir = path.join(appDir, '.next');
	const cacheDir = path.join(appDir, 'node_modules/.cache/next');

	await fs.mkdir(nextDir, {recursive: true});
	await fs.mkdir(cacheDir, {recursive: true});

	const {stdout} = await runCli([
		'--yes',
		'--no-node-modules',
		`--cwd=${appDir}`,
	]);

	expect(stdout.includes('Deleted')).toBe(true);
	expect(await pathExists(nextDir)).toBe(false);
	expect(await pathExists(cacheDir)).toBe(true);
});

test('cli --yes --no-pm-caches skips package-manager caches without --apply', async () => {
	const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-'));
	const appDir = path.join(temporaryDir, 'app');
	const nextDir = path.join(appDir, '.next');
	const pnpmStoreDir = path.join(appDir, '.pnpm-store/v3');

	await fs.mkdir(nextDir, {recursive: true});
	await fs.mkdir(pnpmStoreDir, {recursive: true});

	const {stdout} = await runCli(['--yes', '--no-pm-caches', `--cwd=${appDir}`]);

	expect(stdout.includes('Deleted')).toBe(true);
	expect(await pathExists(nextDir)).toBe(false);
	expect(await pathExists(path.join(appDir, '.pnpm-store'))).toBe(true);
});

test('cli --cleanup-scope=safe excludes node_modules cache candidates', async () => {
	const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-'));
	const appDir = path.join(temporaryDir, 'app');
	await fs.mkdir(path.join(appDir, '.next'), {recursive: true});
	await fs.mkdir(path.join(appDir, 'node_modules/.cache/next'), {
		recursive: true,
	});

	const {stdout} = await runCli([
		'--json',
		'--cleanup-scope=safe',
		`--cwd=${appDir}`,
	]);

	const relativePaths = toRelativePaths(stdout, appDir);

	expect(relativePaths.has('.next')).toBe(true);
	expect(relativePaths.has(path.join('node_modules', '.cache', 'next'))).toBe(
		false,
	);
});

test('cli --monorepo enables workspace cleanup when config monorepoMode is off', async () => {
	const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-'));
	const appDir = path.join(temporaryDir, 'repo');
	const workspaceDir = path.join(appDir, 'packages/web');

	await fs.mkdir(path.join(appDir, '.next'), {recursive: true});
	await fs.mkdir(path.join(workspaceDir, '.next'), {recursive: true});
	await fs.writeFile(
		path.join(appDir, 'package.json'),
		JSON.stringify({
			name: 'repo',
			private: true,
			workspaces: ['packages/*'],
		}),
	);
	await fs.writeFile(
		path.join(workspaceDir, 'package.json'),
		JSON.stringify({name: 'web'}),
	);
	await fs.writeFile(
		path.join(appDir, '.next-prunerc.json'),
		JSON.stringify({monorepoMode: 'off'}),
	);

	const withoutMonorepo = await runCli([
		'--json',
		'--cleanup-scope=workspace',
		`--cwd=${appDir}`,
	]);
	expect(toRelativePaths(withoutMonorepo.stdout, appDir).size).toBe(0);

	const withMonorepo = await runCli([
		'--json',
		'--cleanup-scope=workspace',
		'--monorepo',
		`--cwd=${appDir}`,
	]);
	const relativePaths = toRelativePaths(withMonorepo.stdout, appDir);

	expect(relativePaths.has(path.join('packages', 'web', '.next'))).toBe(true);
	expect(relativePaths.has('.next')).toBe(false);
});

test('cli --workspace-detect enables heuristic workspace discovery when config is manifest-only', async () => {
	const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-'));
	const appDir = path.join(temporaryDir, 'repo');
	const workspaceDir = path.join(appDir, 'apps/site');

	await fs.mkdir(path.join(workspaceDir, '.next'), {recursive: true});
	await fs.writeFile(
		path.join(appDir, 'package.json'),
		JSON.stringify({name: 'repo', private: true}),
	);
	await fs.writeFile(
		path.join(workspaceDir, 'package.json'),
		JSON.stringify({name: 'site'}),
	);
	await fs.writeFile(
		path.join(appDir, '.next-prunerc.json'),
		JSON.stringify({workspaceDiscoveryMode: 'manifest-only'}),
	);

	const withoutFlag = await runCli([
		'--json',
		'--cleanup-scope=workspace',
		`--cwd=${appDir}`,
	]);
	expect(toRelativePaths(withoutFlag.stdout, appDir).size).toBe(0);

	const withFlag = await runCli([
		'--json',
		'--cleanup-scope=workspace',
		'--workspace-detect',
		`--cwd=${appDir}`,
	]);
	const relativePaths = toRelativePaths(withFlag.stdout, appDir);

	expect(relativePaths.has(path.join('apps', 'site', '.next'))).toBe(true);
});

test('cli --yes --dry-run does not delete artifacts', async () => {
	const temporaryDir = await fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-'));
	const appDir = path.join(temporaryDir, 'app');
	const nextDir = path.join(appDir, '.next');

	await fs.mkdir(nextDir, {recursive: true});

	const {stdout} = await runCli(['--yes', '--dry-run', `--cwd=${appDir}`]);

	expect(stdout.includes('Dry-run')).toBe(true);
	expect(await pathExists(nextDir)).toBe(true);
});
