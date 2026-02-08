/** @jsxImportSource @opentui/react */

import {expect, test} from 'bun:test';
import {testRender} from '@opentui/react/test-utils';
import {act} from 'react';
import App from '../../src/app.js';
import {ConfirmDeleteModal} from '../../src/ui/overlays/confirm-delete-modal.js';
import type {ScanItem} from '../../src/core/types.js';

const FIXTURE_ITEMS: ScanItem[] = [
	{
		path: '/tmp/project/.next',
		size: 4096,
		mtime: new Date('2026-01-01T00:00:00.000Z'),
		fileCount: 5,
		isDirectory: true,
		cleanupType: 'artifact',
	},
	{
		path: '/tmp/project/node_modules/.cache/next',
		size: 2048,
		mtime: new Date('2026-01-02T00:00:00.000Z'),
		fileCount: 3,
		isDirectory: true,
		cleanupType: 'workspace-node-modules',
	},
];

test('App renders command center in empty state', async () => {
	const setup = await testRender(
		<App
			testMode
			cwd="/tmp/project"
			config={{
				alwaysDelete: [],
				neverDelete: [],
				checkUnusedAssets: false,
			}}
		/>,
		{width: 120, height: 30},
	);

	try {
		await act(async () => {
			await setup.renderOnce();
		});
		const frame = setup.captureCharFrame();

		expect(frame).toContain('Next');
		expect(frame).toContain('Prune');
		expect(frame).toContain('Command');
		expect(frame).toContain('Center');
		expect(frame).toContain('No candidates match current filter.');
	} finally {
		await act(async () => {
			setup.renderer.destroy();
		});
	}
});

test('App renders seeded candidates in command center layout', async () => {
	const setup = await testRender(
		<App
			testMode
			cwd="/tmp/project"
			testItems={FIXTURE_ITEMS}
			config={{
				alwaysDelete: [],
				neverDelete: [],
				checkUnusedAssets: false,
			}}
		/>,
		{width: 120, height: 30},
	);

	try {
		await act(async () => {
			await setup.renderOnce();
		});
		const frame = setup.captureCharFrame();
		expect(frame).toContain('Candidates (2)');
		expect(frame).toContain('.next');
		expect(frame).toContain('node_modules/.cache/next');
	} finally {
		await act(async () => {
			setup.renderer.destroy();
		});
	}
});

test('App opens confirm overlay when confirmImmediately is enabled', async () => {
	const setup = await testRender(
		<App
			testMode
			confirmImmediately
			dryRun
			cwd="/tmp/project"
			testItems={FIXTURE_ITEMS}
			config={{
				alwaysDelete: [],
				neverDelete: [],
				checkUnusedAssets: false,
			}}
		/>,
		{width: 120, height: 30},
	);

	try {
		await act(async () => {
			await setup.renderOnce();
		});

		const frame = setup.captureCharFrame();
		expect(frame).toContain('Confirm');
		expect(frame).toContain('Deletion');
		expect(frame).toContain('Delete 2 selected');
		expect(frame).toContain('(dry-run)');
	} finally {
		await act(async () => {
			setup.renderer.destroy();
		});
	}
});

test('ConfirmDeleteModal renders confirmation details', async () => {
	const setup = await testRender(
		<ConfirmDeleteModal
			count={3}
			size={2048}
			dryRun
			selectedTypeCounts={{
				artifact: 1,
				asset: 0,
				nodeModules: 1,
				pmCaches: 1,
			}}
			terminalWidth={100}
			terminalHeight={28}
		/>,
		{width: 100, height: 28},
	);

	try {
		await act(async () => {
			await setup.renderOnce();
		});
		const frame = setup.captureCharFrame();

		expect(frame).toContain('Confirm Deletion');
		expect(frame).toContain('Delete 3 selected items?');
		expect(frame).toContain('(dry-run)');
		expect(frame).toContain('NODE 1');
		expect(frame).toContain('--apply');
	} finally {
		await act(async () => {
			setup.renderer.destroy();
		});
	}
});
