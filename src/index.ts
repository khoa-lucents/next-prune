import path from 'node:path';
import process from 'node:process';
import {
	cancel,
	confirm,
	intro,
	isCancel,
	log,
	multiselect,
	note,
	outro,
	select,
	spinner,
} from '@clack/prompts';
import {
	buildCleanupScopeLabel,
	resolveCandidateType,
	type CandidateType,
} from './core/candidates.js';
import {selectAlwaysDeletePaths} from './core/config.js';
import {deleteItems, getTotalSize} from './core/delete.js';
import {human, timeAgo} from './core/format.js';
import type {PruneConfig, RuntimeScanOptions, ScanItem} from './core/types.js';

type SortMode = 'size' | 'age' | 'path';
type TypeCounts = Record<CandidateType, number>;

interface InteractiveCandidate {
	path: string;
	relPath: string;
	size: number;
	mtime: Date | null;
	candidateType: CandidateType;
}

export interface RuntimeProps {
	cwd?: string;
	dryRun?: boolean;
	config?: PruneConfig;
	scanOptions?: RuntimeScanOptions;
	items: readonly ScanItem[];
}

const SORT_OPTIONS: Array<{value: SortMode; label: string; hint: string}> = [
	{value: 'size', label: 'Size (largest first)', hint: 'Default'},
	{value: 'age', label: 'Age (newest first)', hint: 'Recent items first'},
	{value: 'path', label: 'Path (A-Z)', hint: 'Alphabetical order'},
];

const CANDIDATE_TYPE_LABELS: Record<CandidateType, string> = {
	artifact: 'artifact',
	asset: 'asset',
	node_modules: 'node_modules',
	'pm-cache': 'pm-cache',
};

const normalizeMtime = (value: unknown): Date | null => {
	if (value instanceof Date && Number.isFinite(value.getTime())) {
		return value;
	}

	if (typeof value === 'string' || typeof value === 'number') {
		const parsed = new Date(value);
		if (Number.isFinite(parsed.getTime())) {
			return parsed;
		}
	}

	return null;
};

const toInteractiveCandidate = (
	item: ScanItem,
	cwd: string,
): InteractiveCandidate => ({
	path: item.path,
	relPath: path.relative(cwd, item.path) || '.',
	size:
		typeof item.size === 'number' && Number.isFinite(item.size) ? item.size : 0,
	mtime: normalizeMtime(item.mtime),
	candidateType: resolveCandidateType(item),
});

const sortCandidates = (
	items: readonly InteractiveCandidate[],
	sortBy: SortMode,
): InteractiveCandidate[] => {
	const next = [...items];
	next.sort((left, right) => {
		if (sortBy === 'size') return right.size - left.size;
		if (sortBy === 'age') {
			const leftTime = left.mtime?.getTime() ?? 0;
			const rightTime = right.mtime?.getTime() ?? 0;
			return rightTime - leftTime;
		}
		return left.relPath.localeCompare(right.relPath);
	});
	return next;
};

const countByType = (items: readonly InteractiveCandidate[]): TypeCounts => {
	const counts: TypeCounts = {
		artifact: 0,
		asset: 0,
		node_modules: 0,
		'pm-cache': 0,
	};

	for (const item of items) {
		counts[item.candidateType]++;
	}

	return counts;
};

const formatTypeCounts = (counts: TypeCounts): string => {
	const sections = [
		`artifact ${counts.artifact}`,
		`asset ${counts.asset}`,
		`node_modules ${counts.node_modules}`,
		`pm-cache ${counts['pm-cache']}`,
	];
	return sections.join(', ');
};

const truncateMiddle = (value: string, maxLength: number): string => {
	if (maxLength <= 3 || value.length <= maxLength) return value;
	const headLength = Math.ceil((maxLength - 3) / 2);
	const tailLength = Math.floor((maxLength - 3) / 2);
	return `${value.slice(0, headLength)}...${value.slice(-tailLength)}`;
};

const formatHint = (item: InteractiveCandidate): string => {
	const age = item.mtime ? timeAgo(item.mtime) : 'unknown age';
	return `${human(item.size)} | ${age} | ${CANDIDATE_TYPE_LABELS[item.candidateType]}`;
};

const findSelectedCandidates = (
	candidates: readonly InteractiveCandidate[],
	selectedPaths: readonly string[],
): InteractiveCandidate[] => {
	const selectedPathSet = new Set(selectedPaths);
	return candidates.filter(candidate => selectedPathSet.has(candidate.path));
};

export const runInteractiveApp = async ({
	cwd = process.cwd(),
	dryRun = false,
	config,
	scanOptions,
	items,
}: RuntimeProps): Promise<void> => {
	intro('next-prune');

	const candidates = items.map(item => toInteractiveCandidate(item, cwd));
	if (candidates.length === 0) {
		log.info('No prune candidates found in this scope.');
		outro('Nothing to clean up.');
		return;
	}

	const typeCounts = countByType(candidates);
	const scopeLabel = buildCleanupScopeLabel({
		cleanupScope: scanOptions?.cleanupScope,
		includeNodeModules: scanOptions?.includeNodeModules,
		includeProjectLocalPmCaches: scanOptions?.includeProjectLocalPmCaches,
	});
	note(
		[
			`Path: ${cwd}`,
			`Scope: ${scopeLabel}`,
			`Found: ${candidates.length} candidates (${human(getTotalSize(candidates))})`,
			`Types: ${formatTypeCounts(typeCounts)}`,
			dryRun ? 'Mode: dry-run' : 'Mode: apply on confirmation',
		].join('\n'),
		'Scan summary',
	);

	const sortBy = await select<SortMode>({
		message: 'Sort candidates by:',
		initialValue: 'size',
		options: SORT_OPTIONS,
	});
	if (isCancel(sortBy)) {
		cancel('Operation cancelled.');
		return;
	}

	const sortedCandidates = sortCandidates(candidates, sortBy);
	const defaultSelections = [
		...selectAlwaysDeletePaths(
			sortedCandidates.map(candidate => ({path: candidate.path})),
			cwd,
			config?.alwaysDelete ?? [],
		),
	].filter(defaultSelectionPath =>
		sortedCandidates.some(candidate => candidate.path === defaultSelectionPath),
	);

	const selectedPaths = await multiselect<string>({
		message: 'Select candidates to prune:',
		required: true,
		maxItems: 12,
		initialValues: defaultSelections,
		options: sortedCandidates.map(candidate => ({
			value: candidate.path,
			label: truncateMiddle(candidate.relPath, 72),
			hint: formatHint(candidate),
		})),
	});
	if (isCancel(selectedPaths)) {
		cancel('Operation cancelled.');
		return;
	}

	const selectedCandidates = findSelectedCandidates(
		sortedCandidates,
		selectedPaths,
	);
	const selectedSize = getTotalSize(selectedCandidates);
	if (selectedCandidates.length === 0) {
		log.warning('No candidates were selected.');
		outro('No changes were made.');
		return;
	}

	const containsProtectedTargets = selectedCandidates.some(
		candidate =>
			candidate.candidateType === 'node_modules' ||
			candidate.candidateType === 'pm-cache',
	);
	if (containsProtectedTargets) {
		log.warn(
			'Selection includes node_modules or package-manager caches. Review carefully before deleting.',
		);
		const protectedConfirm = await confirm({
			message:
				'Continue with protected targets (node_modules/pm-cache) in interactive mode?',
			initialValue: false,
		});
		if (isCancel(protectedConfirm)) {
			cancel('Operation cancelled.');
			return;
		}
		if (!protectedConfirm) {
			outro('No changes were made.');
			return;
		}
	}

	const shouldProceed = await confirm({
		message: dryRun
			? `Run dry-run for ${selectedCandidates.length} selected items (${human(selectedSize)})?`
			: `Delete ${selectedCandidates.length} selected items (${human(selectedSize)})?`,
		initialValue: false,
	});
	if (isCancel(shouldProceed)) {
		cancel('Operation cancelled.');
		return;
	}
	if (!shouldProceed) {
		outro('No changes were made.');
		return;
	}

	if (dryRun) {
		log.success(
			`Dry-run: would delete ${selectedCandidates.length} items (${human(selectedSize)}).`,
		);
		outro('Dry-run complete.');
		return;
	}

	const deletionSpinner = spinner();
	deletionSpinner.start(`Deleting ${selectedCandidates.length} selected items`);
	const summary = await deleteItems(
		selectedCandidates.map(candidate => ({
			path: candidate.path,
			size: candidate.size,
		})),
	);

	if (summary.failureCount === 0) {
		deletionSpinner.stop(
			`Deleted ${summary.deletedCount}/${selectedCandidates.length} items. Reclaimed ${human(summary.reclaimedBytes)}.`,
		);
		outro('Cleanup finished.');
		return;
	}

	deletionSpinner.stop(
		`Deleted ${summary.deletedCount}/${selectedCandidates.length} items. Reclaimed ${human(summary.reclaimedBytes)}.`,
		1,
	);
	for (const result of summary.results) {
		if (result.ok) continue;
		const relativePath = path.relative(cwd, result.path) || '.';
		log.error(`Failed to delete ${relativePath}: ${String(result.error)}`);
	}
	outro('Cleanup finished with errors.');
};
