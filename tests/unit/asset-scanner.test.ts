import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {expect, test} from 'bun:test';
import {findUnusedAssets} from '../../src/core/asset-scanner.js';

const createTempDirectory = async (): Promise<string> =>
	fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-assets-'));

test('basename fallback is applied only for unique filenames', async () => {
	const cwd = await createTempDirectory();

	await fs.mkdir(path.join(cwd, 'public/images/a'), {recursive: true});
	await fs.mkdir(path.join(cwd, 'public/images/b'), {recursive: true});
	await fs.mkdir(path.join(cwd, 'public/icons'), {recursive: true});
	await fs.mkdir(path.join(cwd, 'src'), {recursive: true});

	await fs.writeFile(path.join(cwd, 'public/images/a/logo.png'), '');
	await fs.writeFile(path.join(cwd, 'public/images/b/logo.png'), '');
	await fs.writeFile(path.join(cwd, 'public/icons/unique.png'), '');

	await fs.writeFile(
		path.join(cwd, 'src/index.tsx'),
		[
			'const unique = "unique.png";',
			'const exact = "/images/a/logo.png";',
			'const duplicateNameOnly = "logo.png";',
			'export const sample = {unique, exact, duplicateNameOnly};',
		].join('\n'),
	);

	const unused = (await findUnusedAssets(cwd))
		.map(assetPath => path.relative(path.join(cwd, 'public'), assetPath))
		.sort();

	expect(unused).toEqual([path.join('images', 'b', 'logo.png')]);
});

test('source walk skips noisy directories', async () => {
	const cwd = await createTempDirectory();

	await fs.mkdir(path.join(cwd, 'public/assets'), {recursive: true});
	await fs.mkdir(path.join(cwd, 'src/node_modules/fake-package'), {
		recursive: true,
	});
	await fs.mkdir(path.join(cwd, 'src/components'), {recursive: true});

	await fs.writeFile(path.join(cwd, 'public/assets/hero.png'), '');
	await fs.writeFile(
		path.join(cwd, 'src/node_modules/fake-package/index.ts'),
		'export const fake = "/assets/hero.png";',
	);
	await fs.writeFile(
		path.join(cwd, 'src/components/page.tsx'),
		'export const page = "no asset refs";',
	);

	const unused = await findUnusedAssets(cwd);

	expect(unused.map(assetPath => path.relative(cwd, assetPath))).toEqual([
		path.join('public', 'assets', 'hero.png'),
	]);
});
