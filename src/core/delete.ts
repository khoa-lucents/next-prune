import fs from 'node:fs/promises';
import type {DeleteResult, DeleteSummary, ScanItem} from './types.js';

const normalizeSize = (size: unknown): number =>
	typeof size === 'number' && Number.isFinite(size) && size > 0 ? size : 0;

export const getTotalSize = (
	items: Iterable<Pick<ScanItem, 'size'>>,
): number => {
	let total = 0;
	for (const item of items) {
		total += normalizeSize(item.size);
	}

	return total;
};

export const deleteItem = async (
	item: Pick<ScanItem, 'path' | 'size'>,
): Promise<DeleteResult> => {
	const itemSize = normalizeSize(item.size);

	try {
		await fs.rm(item.path, {recursive: true, force: true});
		return {path: item.path, ok: true, size: itemSize};
	} catch (error) {
		return {path: item.path, ok: false, size: itemSize, error};
	}
};

export const summarizeDeletionResults = (
	results: readonly DeleteResult[],
): DeleteSummary => {
	let deletedCount = 0;
	let reclaimedBytes = 0;
	for (const result of results) {
		if (!result.ok) continue;
		deletedCount++;
		reclaimedBytes += normalizeSize(result.size);
	}

	return {
		results: [...results],
		deletedCount,
		failureCount: results.length - deletedCount,
		reclaimedBytes,
	};
};

export const deleteItems = async (
	items: readonly Pick<ScanItem, 'path' | 'size'>[],
): Promise<DeleteSummary> => {
	const results = await Promise.all(items.map(async item => deleteItem(item)));
	return summarizeDeletionResults(results);
};
