/** @jsxImportSource @opentui/react */

import {createCliRenderer} from '@opentui/core';
import {createRoot} from '@opentui/react';
import App from './app.js';
import type {PruneConfig, RuntimeScanOptions} from './core/types.js';

export interface RuntimeProps {
	cwd?: string;
	dryRun?: boolean;
	confirmImmediately?: boolean;
	config?: PruneConfig;
	scanOptions?: RuntimeScanOptions;
}

export const runInteractiveApp = async (props: RuntimeProps): Promise<void> => {
	const renderer = await createCliRenderer({
		exitOnCtrlC: true,
	});

	const root = createRoot(renderer);
	root.render(<App {...props} />);
};
