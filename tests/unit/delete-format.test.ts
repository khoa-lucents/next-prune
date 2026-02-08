import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {expect, test} from 'bun:test';
import {
	deleteItems,
	getTotalSize,
	summarizeDeletionResults,
} from '../../src/core/delete.js';
import {human, timeAgo} from '../../src/core/format.js';

const createTempDirectory = async (): Promise<string> =>
	fs.mkdtemp(path.join(os.tmpdir(), 'next-prune-delete-'));

test('human and timeAgo handle baseline formatting', () => {
	expect(human(0)).toBe('0 B');
	expect(human(1024)).toBe('1.0 KB');
	expect(human(undefined)).toBe('-');

	const now = new Date('2026-02-08T12:00:00.000Z').getTime();
	expect(timeAgo(new Date(now - 65_000), now)).toBe('1m ago');
	expect(timeAgo(new Date(now + 10_000), now)).toBe('0s ago');
	expect(timeAgo(null)).toBe('');
});

test('deleteItems returns success/failure summary and reclaimed bytes', async () => {
	const cwd = await createTempDirectory();
	const removablePath = path.join(cwd, '.next');
	const invalidPath = '\0invalid';

	await fs.mkdir(removablePath, {recursive: true});
	await fs.writeFile(path.join(removablePath, 'cache.txt'), 'cache');

	const summary = await deleteItems([
		{path: removablePath, size: 5},
		{path: invalidPath, size: 7},
	]);

	expect(summary.deletedCount).toBe(1);
	expect(summary.failureCount).toBe(1);
	expect(summary.reclaimedBytes).toBe(5);
	expect(
		await fs
			.stat(removablePath)
			.then(() => true)
			.catch(() => false),
	).toBe(false);
});

test('getTotalSize and summarizeDeletionResults use normalized numeric sizes', () => {
	expect(
		getTotalSize([{size: 1}, {size: Number.NaN}, {size: -2}, {size: 3}]),
	).toBe(4);

	const summary = summarizeDeletionResults([
		{path: 'a', ok: true, size: 3},
		{path: 'b', ok: false, size: 9, error: new Error('fail')},
		{path: 'c', ok: true, size: 0},
	]);

	expect(summary.deletedCount).toBe(2);
	expect(summary.failureCount).toBe(1);
	expect(summary.reclaimedBytes).toBe(3);
});
