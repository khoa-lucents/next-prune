import type {
	ArtifactItem,
	Metrics,
	SelectedTypeCounts,
	SortMode,
} from '../types.js';

export const sortItems = (
	items: readonly ArtifactItem[],
	sortBy: SortMode,
): ArtifactItem[] => {
	const next = [...items];
	next.sort((left, right) => {
		if (sortBy === 'size') return right.size - left.size;
		if (sortBy === 'age') return right.mtime.getTime() - left.mtime.getTime();
		return left.relPath.localeCompare(right.relPath);
	});
	return next;
};

export const filterItemsByQuery = (
	items: readonly ArtifactItem[],
	query: string,
): ArtifactItem[] => {
	const normalizedQuery = query.trim().toLowerCase();
	if (!normalizedQuery) return [...items];
	return items.filter(item =>
		item.relPath.toLowerCase().includes(normalizedQuery),
	);
};

export const buildMetrics = (
	items: readonly ArtifactItem[],
	selectedPaths: ReadonlySet<string>,
): Metrics => {
	let foundCount = 0;
	let totalSize = 0;
	let selectedCount = 0;
	let selectedSize = 0;
	let nodeModulesCount = 0;
	let pmCachesCount = 0;

	for (const item of items) {
		if (item.status === 'deleted') continue;
		foundCount++;
		totalSize += item.size;
		if (item.candidateType === 'node_modules') nodeModulesCount++;
		if (item.candidateType === 'pm-cache') pmCachesCount++;
		if (selectedPaths.has(item.path)) {
			selectedCount++;
			selectedSize += item.size;
		}
	}

	return {
		foundCount,
		totalSize,
		selectedCount,
		selectedSize,
		nodeModulesCount,
		pmCachesCount,
	};
};

export const buildSelectedTypeCounts = (
	items: readonly ArtifactItem[],
	selectedPaths: ReadonlySet<string>,
): SelectedTypeCounts => {
	const counts: SelectedTypeCounts = {
		artifact: 0,
		asset: 0,
		nodeModules: 0,
		pmCaches: 0,
	};

	for (const item of items) {
		if (item.status === 'deleted' || !selectedPaths.has(item.path)) continue;

		if (item.candidateType === 'asset') {
			counts.asset++;
			continue;
		}

		if (item.candidateType === 'node_modules') {
			counts.nodeModules++;
			continue;
		}

		if (item.candidateType === 'pm-cache') {
			counts.pmCaches++;
			continue;
		}

		counts.artifact++;
	}

	return counts;
};

export const buildViewWindow = (
	cursorIndex: number,
	height: number,
	total: number,
): {start: number; end: number} => {
	const half = Math.floor(height / 2);
	let start = Math.max(0, cursorIndex - half);
	const end = start + height;
	if (end > total) {
		start = Math.max(0, total - height);
	}
	return {
		start,
		end: Math.min(start + height, total),
	};
};
