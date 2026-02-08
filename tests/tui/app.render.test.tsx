/** @jsxImportSource @opentui/react */

import {expect, test} from 'bun:test';
import {testRender} from '@opentui/react/test-utils';
import {act} from 'react';
import App from '../../src/app.js';
import {ConfirmModal} from '../../src/ui/confirm-modal.js';

test('App renders core layout in empty state', async () => {
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
		{width: 100, height: 28},
	);

	try {
		await act(async () => {
			await setup.renderOnce();
		});
		const frame = setup.captureCharFrame();

		expect(frame).toContain('Next');
		expect(frame).toContain('Prune');
		expect(frame).toContain('No');
		expect(frame).toContain('artifacts');
		expect(frame).toContain('found.');
	} finally {
		await act(async () => {
			setup.renderer.destroy();
		});
	}
});

test('ConfirmModal renders confirmation details', async () => {
	const setup = await testRender(
		<ConfirmModal
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
		expect(frame).toContain('Delete 3 items?');
		expect(frame).toContain('(dry-run)');
		expect(frame).toContain('Types:');
		expect(frame).toContain('[NODE 1]');
		expect(frame).toContain('--apply');
	} finally {
		await act(async () => {
			setup.renderer.destroy();
		});
	}
});
