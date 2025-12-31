import path from 'node:path';
import fs from 'node:fs/promises';

export const DEFAULT_CONFIG = {
	alwaysDelete: [],
	neverDelete: [],
	checkUnusedAssets: false,
};

export const loadConfig = async cwd => {
	let config = {...DEFAULT_CONFIG};

	// 1. Check package.json
	try {
		const pkgPath = path.join(cwd, 'package.json');
		const pkgStr = await fs.readFile(pkgPath, 'utf8');
		const pkg = JSON.parse(pkgStr);
		if (pkg['next-prune']) {
			config = {...config, ...pkg['next-prune']};
		}
	} catch {
		// Ignore if package.json not found or invalid
	}

	// 2. Check .next-prunerc.json (overrides package.json)
	try {
		const rcPath = path.join(cwd, '.next-prunerc.json');
		const rcStr = await fs.readFile(rcPath, 'utf8');
		const rc = JSON.parse(rcStr);
		config = {...config, ...rc};
	} catch {
		// Ignore
	}

	// Normalize arrays
	if (!Array.isArray(config.alwaysDelete)) config.alwaysDelete = [];
	if (!Array.isArray(config.neverDelete)) config.neverDelete = [];

	return config;
};
