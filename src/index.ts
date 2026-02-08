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
	text,
} from '@clack/prompts';
import {
	buildCleanupScopeLabel,
	resolveCandidateType,
	type CandidateType,
} from './core/candidates.js';
import {selectAlwaysDeletePaths} from './core/config.js';
import {deleteItems, getTotalSize} from './core/delete.js';
import {human, timeAgo} from './core/format.js';
import type {
	CleanupScope,
	PruneConfig,
	RuntimeScanOptions,
	ScanItem,
} from './core/types.js';

type SortMode = 'size' | 'age' | 'path';
type TypeCounts = Record<CandidateType, number>;
type ScopeMode = 'all' | CleanupScope;
type CleanupProfile =
	| 'config-default'
	| 'safe'
	| 'deps-only'
	| 'cold-storage'
	| 'custom';

interface InteractiveCandidate {
	path: string;
	relPath: string;
	size: number;
	mtime: Date | null;
	candidateType: CandidateType;
	cleanupScope: CleanupScope;
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

const CLEANUP_PROFILE_OPTIONS: Array<{
	value: CleanupProfile;
	label: string;
	hint: string;
}> = [
	{
		value: 'config-default',
		label: 'Use current scan defaults',
		hint: 'Respect current CLI/config scan behavior',
	},
	{
		value: 'safe',
		label: 'Safe artifacts only',
		hint: 'Build outputs + optional unused assets',
	},
	{
		value: 'deps-only',
		label: 'Dependencies and caches',
		hint: 'node_modules + package-manager caches',
	},
	{
		value: 'cold-storage',
		label: 'Cold storage (aggressive)',
		hint: 'Everything for maximum size reduction',
	},
	{
		value: 'custom',
		label: 'Custom mix',
		hint: 'Pick candidate families and scope manually',
	},
];

const SCOPE_MODE_OPTIONS: Array<{
	value: ScopeMode;
	label: string;
	hint: string;
}> = [
	{
		value: 'all',
		label: 'All scanned scopes',
		hint: 'Project + workspace candidates',
	},
	{
		value: 'project',
		label: 'Project scope only',
		hint: 'Current root project candidates',
	},
	{
		value: 'workspace',
		label: 'Workspace scope only',
		hint: 'Detected monorepo workspace candidates',
	},
];

const TYPE_MODE_LABELS: Record<CandidateType, string> = {
	artifact: 'Build artifacts',
	asset: 'Unused assets',
	node_modules: 'node_modules',
	'pm-cache': 'Package-manager caches',
};

const CANDIDATE_TYPE_LABELS: Record<CandidateType, string> = {
	artifact: 'artifact',
	asset: 'asset',
	node_modules: 'node_modules',
	'pm-cache': 'pm-cache',
};

const DEFAULT_PROFILE_TYPES: CandidateType[] = [
	'artifact',
	'asset',
	'node_modules',
	'pm-cache',
];

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
	cleanupScope: item.cleanupScope ?? 'project',
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

const countByScope = (
	items: readonly InteractiveCandidate[],
): Record<CleanupScope, number> => {
	const counts: Record<CleanupScope, number> = {
		project: 0,
		workspace: 0,
	};
	for (const item of items) {
		counts[item.cleanupScope]++;
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

const formatScopeCounts = (counts: Record<CleanupScope, number>): string =>
	`project ${counts.project}, workspace ${counts.workspace}`;

const truncateMiddle = (value: string, maxLength: number): string => {
	if (maxLength <= 3 || value.length <= maxLength) return value;
	const headLength = Math.ceil((maxLength - 3) / 2);
	const tailLength = Math.floor((maxLength - 3) / 2);
	return `${value.slice(0, headLength)}...${value.slice(-tailLength)}`;
};

const formatHint = (item: InteractiveCandidate): string => {
	const age = item.mtime ? timeAgo(item.mtime) : 'unknown age';
	return `${human(item.size)} | ${age} | ${CANDIDATE_TYPE_LABELS[item.candidateType]} | ${item.cleanupScope}`;
};

const findSelectedCandidates = (
	candidates: readonly InteractiveCandidate[],
	selectedPaths: readonly string[],
): InteractiveCandidate[] => {
	const selectedPathSet = new Set(selectedPaths);
	return candidates.filter(candidate => selectedPathSet.has(candidate.path));
};

const intersectTypes = (
	available: ReadonlySet<CandidateType>,
	types: readonly CandidateType[],
): Set<CandidateType> => {
	const selected = new Set<CandidateType>();
	for (const type of types) {
		if (available.has(type)) selected.add(type);
	}
	return selected;
};

const resolvePresetTypes = (
	profile: Exclude<CleanupProfile, 'custom'>,
	availableTypes: ReadonlySet<CandidateType>,
): Set<CandidateType> => {
	if (profile === 'safe') {
		return intersectTypes(availableTypes, ['artifact', 'asset']);
	}
	if (profile === 'deps-only') {
		return intersectTypes(availableTypes, ['node_modules', 'pm-cache']);
	}
	return intersectTypes(availableTypes, DEFAULT_PROFILE_TYPES);
};

const filterCandidates = (
	candidates: readonly InteractiveCandidate[],
	options: {
		typeSet: ReadonlySet<CandidateType>;
		scopeMode: ScopeMode;
		query: string;
	},
): InteractiveCandidate[] => {
	const normalizedQuery = options.query.trim().toLowerCase();
	return candidates.filter(candidate => {
		if (!options.typeSet.has(candidate.candidateType)) return false;
		if (
			options.scopeMode !== 'all' &&
			candidate.cleanupScope !== options.scopeMode
		) {
			return false;
		}
		if (!normalizedQuery) return true;
		return candidate.relPath.toLowerCase().includes(normalizedQuery);
	});
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
	const scopeCounts = countByScope(candidates);
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
			`Scopes: ${formatScopeCounts(scopeCounts)}`,
			dryRun ? 'Mode: dry-run' : 'Mode: apply on confirmation',
		].join('\n'),
		'Scan summary',
	);

	const profile = await select<CleanupProfile>({
		message: 'Choose cleanup profile:',
		initialValue: 'config-default',
		options: CLEANUP_PROFILE_OPTIONS,
	});
	if (isCancel(profile)) {
		cancel('Operation cancelled.');
		return;
	}

	const availableTypes = new Set(
		candidates.map(candidate => candidate.candidateType),
	);
	let activeTypes =
		profile === 'custom'
			? new Set<CandidateType>()
			: resolvePresetTypes(profile, availableTypes);
	if (profile === 'custom') {
		const selectedTypes = await multiselect<CandidateType>({
			message: 'Select candidate families:',
			required: true,
			initialValues: [...availableTypes],
			options: DEFAULT_PROFILE_TYPES.map(type => ({
				value: type,
				label: TYPE_MODE_LABELS[type],
				hint: `${typeCounts[type]} found`,
			})),
		});
		if (isCancel(selectedTypes)) {
			cancel('Operation cancelled.');
			return;
		}
		activeTypes = new Set(selectedTypes);
	}
	if (activeTypes.size === 0) {
		log.warning('No candidates match the selected profile in this scan.');
		note(
			'Try running with --cold-storage or adjust --cleanup-scope / include flags to expand scan coverage.',
			'Tip',
		);
		outro('No changes were made.');
		return;
	}

	const availableScopes = new Set(
		candidates.map(candidate => candidate.cleanupScope),
	);
	let scopeMode: ScopeMode = 'all';
	if (availableScopes.size === 1) {
		scopeMode = [...availableScopes][0] as CleanupScope;
	} else {
		const selectedScopeMode = await select<ScopeMode>({
			message: 'Select scope coverage:',
			initialValue: 'all',
			options: SCOPE_MODE_OPTIONS.filter(option =>
				option.value === 'all'
					? true
					: availableScopes.has(option.value as CleanupScope),
			),
		});
		if (isCancel(selectedScopeMode)) {
			cancel('Operation cancelled.');
			return;
		}
		scopeMode = selectedScopeMode;
	}

	const pathFilterInput = await text({
		message: 'Filter paths by substring (optional):',
		placeholder: 'Press Enter to include all candidates',
		defaultValue: '',
	});
	if (isCancel(pathFilterInput)) {
		cancel('Operation cancelled.');
		return;
	}

	const filteredCandidates = filterCandidates(candidates, {
		typeSet: activeTypes,
		scopeMode,
		query: pathFilterInput,
	});
	if (filteredCandidates.length === 0) {
		log.warning('No candidates matched the selected filters.');
		outro('No changes were made.');
		return;
	}
	note(
		[
			`Profile: ${profile}`,
			`Scope filter: ${scopeMode}`,
			`Path filter: ${pathFilterInput.trim() ? pathFilterInput.trim() : '(none)'}`,
			`Candidates in view: ${filteredCandidates.length} (${human(getTotalSize(filteredCandidates))})`,
		].join('\n'),
		'Selection filters',
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

	const sortedCandidates = sortCandidates(filteredCandidates, sortBy);
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
