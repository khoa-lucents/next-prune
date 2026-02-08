/** @jsxImportSource @opentui/react */

import process from 'node:process';
import {useCallback, useEffect, useMemo, useReducer, useRef} from 'react';
import {useKeyboard, useRenderer, useTerminalDimensions} from '@opentui/react';
import {findUnusedAssets} from './core/asset-scanner.js';
import {filterNeverDelete, selectAlwaysDeletePaths} from './core/config.js';
import {deleteItems} from './core/delete.js';
import {human} from './core/format.js';
import {getArtifactStats, scanArtifacts} from './core/scanner.js';
import type {PruneConfig, RuntimeScanOptions, ScanItem} from './core/types.js';
import {SummaryStrip} from './ui/chrome/summary-strip.js';
import {StatusLine} from './ui/chrome/status-line.js';
import {LayoutShell} from './ui/layout-shell.js';
import {ConfirmDeleteModal} from './ui/overlays/confirm-delete-modal.js';
import {HelpOverlay} from './ui/overlays/help-overlay.js';
import {DetailsPane} from './ui/panes/details-pane.js';
import {CandidateListPane} from './ui/panes/candidate-list-pane.js';
import {SearchBar} from './ui/search/search-bar.js';
import {uiReducer, createInitialUiState} from './ui/state/reducer.js';
import {
	buildMetrics,
	buildSelectedTypeCounts,
	buildViewWindow,
	filterItemsByQuery,
	sortItems,
} from './ui/state/selectors.js';
import type {ArtifactItem, ArtifactStatus} from './ui/types.js';
import {
	buildCleanupScopeLabel,
	clampIndex,
	normalizeItem,
	resolveAllowedCandidateTypes,
	resolveConfig,
	resolveScanOptions,
	sumItemSizes,
} from './ui/view-model/candidates.js';

interface AppProps {
	cwd?: string;
	dryRun?: boolean;
	confirmImmediately?: boolean;
	testMode?: boolean;
	config?: Partial<PruneConfig>;
	scanOptions?: RuntimeScanOptions;
	testItems?: Array<ScanItem & {status?: ArtifactStatus}>;
}

const parseErrorMessage = (error: unknown, fallback: string): string =>
	String(error instanceof Error ? error.message : (error ?? fallback));

export default function App({
	cwd = process.cwd(),
	dryRun = false,
	confirmImmediately = false,
	testMode = false,
	config,
	scanOptions,
	testItems,
}: AppProps) {
	const renderer = useRenderer();
	const {width, height} = useTerminalDimensions();
	const terminalWidth = Math.max(72, width || 100);
	const terminalHeight = Math.max(20, height || 28);

	const resolvedConfig = useMemo(() => resolveConfig(config), [config]);
	const resolvedScanOptions = useMemo(
		() => resolveScanOptions(scanOptions, resolvedConfig),
		[resolvedConfig, scanOptions],
	);
	const allowedCandidateTypes = useMemo(
		() => resolveAllowedCandidateTypes(resolvedScanOptions),
		[resolvedScanOptions],
	);
	const cleanupScopeLabel = useMemo(
		() => buildCleanupScopeLabel(resolvedScanOptions),
		[resolvedScanOptions],
	);

	const [state, dispatch] = useReducer(
		uiReducer,
		createInitialUiState({startLoading: !testMode}),
	);
	const stateRef = useRef(state);
	useEffect(() => {
		stateRef.current = state;
	}, [state]);

	const sortedItems = useMemo(
		() => sortItems(state.items, state.sortBy),
		[state.items, state.sortBy],
	);
	const visibleItems = useMemo(
		() => filterItemsByQuery(sortedItems, state.query),
		[sortedItems, state.query],
	);
	const metrics = useMemo(
		() => buildMetrics(state.items, state.selectedPaths),
		[state.items, state.selectedPaths],
	);
	const selectedTypeCounts = useMemo(
		() => buildSelectedTypeCounts(state.items, state.selectedPaths),
		[state.items, state.selectedPaths],
	);

	useEffect(() => {
		dispatch({type: 'ENSURE_CURSOR', total: visibleItems.length});
	}, [visibleItems.length]);

	const focusedItem = visibleItems[state.cursorIndex];
	const compactLayout = terminalWidth < 110;
	const listHeight = Math.max(5, terminalHeight - (compactLayout ? 24 : 12));
	const viewWindow = useMemo(
		() => buildViewWindow(state.cursorIndex, listHeight, visibleItems.length),
		[state.cursorIndex, listHeight, visibleItems.length],
	);

	const quit = useCallback(() => {
		renderer.destroy();
	}, [renderer]);

	const applyInitialSelection = useCallback(
		(items: ArtifactItem[]): string[] => {
			if (confirmImmediately) {
				return items
					.filter(item => item.status !== 'deleted')
					.map(item => item.path);
			}
			if (resolvedConfig.alwaysDelete.length === 0) {
				return [];
			}
			return [
				...selectAlwaysDeletePaths(
					items.filter(item => item.status !== 'deleted'),
					cwd,
					resolvedConfig.alwaysDelete,
				),
			];
		},
		[confirmImmediately, cwd, resolvedConfig.alwaysDelete],
	);

	const collectItems = useCallback(async (): Promise<ArtifactItem[]> => {
		const scannerOptions = resolvedScanOptions.scannerOptions;
		let next: Array<ScanItem & {status?: ArtifactStatus}> = await scanArtifacts(
			cwd,
			scannerOptions,
		);

		if (resolvedConfig.checkUnusedAssets) {
			const assetPaths = await findUnusedAssets(cwd, {
				skipDirs: scannerOptions.skipDirs,
			});
			const assetStats = await Promise.all(
				assetPaths.map(async assetPath => getArtifactStats(assetPath)),
			);
			next = next.concat(
				assetPaths.map((assetPath, index) => ({
					path: assetPath,
					...assetStats[index],
					type: 'asset' as const,
				})),
			);
		}

		next = filterNeverDelete(next, cwd, resolvedConfig.neverDelete);
		return next
			.map(item => normalizeItem(item, cwd))
			.filter(item => allowedCandidateTypes.has(item.candidateType));
	}, [
		allowedCandidateTypes,
		cwd,
		resolvedConfig.checkUnusedAssets,
		resolvedConfig.neverDelete,
		resolvedScanOptions,
	]);

	const finalizeScan = useCallback(
		(next: ArtifactItem[]) => {
			const selectedPaths = applyInitialSelection(next);
			dispatch({type: 'SCAN_SUCCESS', items: next, selectedPaths});
			if (confirmImmediately && selectedPaths.length > 0) {
				dispatch({type: 'OPEN_CONFIRM'});
			}
		},
		[applyInitialSelection, confirmImmediately],
	);

	const runScan = useCallback(async () => {
		dispatch({type: 'SCAN_START'});
		try {
			const next = await collectItems();
			finalizeScan(next);
		} catch (error) {
			dispatch({
				type: 'SCAN_FAILURE',
				message: parseErrorMessage(error, 'Scan failed'),
			});
		}
	}, [collectItems, finalizeScan]);

	useEffect(() => {
		if (!testMode) {
			void runScan();
			return;
		}

		if (testItems) {
			const normalized = filterNeverDelete(
				testItems,
				cwd,
				resolvedConfig.neverDelete,
			)
				.map(item => normalizeItem(item, cwd))
				.filter(item => allowedCandidateTypes.has(item.candidateType));
			finalizeScan(normalized);
		}
	}, [
		allowedCandidateTypes,
		cwd,
		finalizeScan,
		resolvedConfig.neverDelete,
		runScan,
		testItems,
		testMode,
	]);

	const focusRow = useCallback(
		(index: number) => {
			dispatch({type: 'SET_FOCUS_ZONE', zone: 'list'});
			dispatch({type: 'SET_CURSOR', index, total: visibleItems.length});
		},
		[visibleItems.length],
	);

	const toggleRowSelection = useCallback(
		(index: number) => {
			const item = visibleItems[index];
			if (!item || item.status === 'deleted') return;
			focusRow(index);
			dispatch({type: 'TOGGLE_SELECTION', path: item.path});
		},
		[focusRow, visibleItems],
	);

	const toggleFocusedSelection = useCallback(() => {
		const currentState = stateRef.current;
		const item = visibleItems[currentState.cursorIndex];
		if (!item || item.status === 'deleted') return;
		dispatch({type: 'TOGGLE_SELECTION', path: item.path});
	}, [visibleItems]);

	const selectAllVisible = useCallback(() => {
		dispatch({
			type: 'SELECT_PATHS',
			paths: visibleItems
				.filter(item => item.status !== 'deleted')
				.map(item => item.path),
		});
	}, [visibleItems]);

	const openDeleteConfirm = useCallback(() => {
		const currentState = stateRef.current;
		if (currentState.selectedPaths.size === 0) {
			const fallbackItem = visibleItems[currentState.cursorIndex];
			if (!fallbackItem || fallbackItem.status === 'deleted') {
				dispatch({
					type: 'SET_STATUS',
					status: {
						kind: 'info',
						message: 'Select at least one candidate before deleting.',
					},
				});
				return;
			}
			dispatch({type: 'SELECT_PATHS', paths: [fallbackItem.path]});
		}
		dispatch({type: 'OPEN_CONFIRM'});
	}, [visibleItems]);

	const performDeletion = useCallback(async () => {
		const currentState = stateRef.current;
		const itemByPath = new Map(
			currentState.items.map(item => [item.path, item] as const),
		);
		const targets = [...currentState.selectedPaths]
			.map(targetPath => itemByPath.get(targetPath))
			.filter((item): item is ArtifactItem =>
				Boolean(item && item.status !== 'deleted'),
			);

		if (targets.length === 0) {
			dispatch({type: 'CLOSE_CONFIRM'});
			return;
		}

		const targetPaths = targets.map(item => item.path);

		if (dryRun) {
			dispatch({
				type: 'MARK_ITEMS_STATUS',
				paths: targetPaths,
				status: 'dry-run',
			});
			dispatch({type: 'CLEAR_SELECTION'});
			dispatch({type: 'CLOSE_CONFIRM'});
			dispatch({
				type: 'SET_STATUS',
				status: {
					kind: 'success',
					message: `Dry-run: would delete ${targets.length} items (${human(sumItemSizes(targets))})`,
				},
			});
			return;
		}

		dispatch({
			type: 'MARK_ITEMS_STATUS',
			paths: targetPaths,
			status: 'deleting',
		});

		try {
			const summary = await deleteItems(
				targets.map(item => ({
					path: item.path,
					size: item.size,
				})),
			);

			const succeeded: string[] = [];
			const failed: string[] = [];
			for (const result of summary.results) {
				if (result.ok) {
					succeeded.push(result.path);
				} else {
					failed.push(result.path);
				}
			}

			dispatch({
				type: 'APPLY_DELETE_RESULTS',
				succeeded,
				failed,
			});

			if (summary.failureCount > 0 && summary.deletedCount > 0) {
				dispatch({
					type: 'SET_STATUS',
					status: {
						kind: 'info',
						message: `Deleted ${summary.deletedCount} items (freed ${human(summary.reclaimedBytes)}), ${summary.failureCount} failed`,
					},
				});
			} else if (summary.failureCount > 0) {
				dispatch({
					type: 'SET_STATUS',
					status: {
						kind: 'error',
						message: `Failed to delete ${summary.failureCount} items`,
					},
				});
			} else {
				dispatch({
					type: 'SET_STATUS',
					status: {
						kind: 'success',
						message: `Deleted ${summary.deletedCount} items (freed ${human(summary.reclaimedBytes)})`,
					},
				});
			}
		} catch (error) {
			dispatch({
				type: 'MARK_ITEMS_STATUS',
				paths: targetPaths,
				status: 'error',
			});
			dispatch({
				type: 'SET_STATUS',
				status: {
					kind: 'error',
					message: parseErrorMessage(error, 'Deletion failed'),
				},
			});
		}

		dispatch({type: 'CLEAR_SELECTION'});
		dispatch({type: 'CLOSE_CONFIRM'});
	}, [dryRun]);

	const moveToMatch = useCallback(
		(direction: 1 | -1) => {
			const currentState = stateRef.current;
			if (!currentState.query || visibleItems.length === 0) return;
			const nextIndex = clampIndex(
				(currentState.cursorIndex + direction + visibleItems.length) %
					visibleItems.length,
				visibleItems.length,
			);
			dispatch({
				type: 'SET_CURSOR',
				index: nextIndex,
				total: visibleItems.length,
			});
		},
		[visibleItems.length],
	);

	useKeyboard(key => {
		const keyName = String(key.name ?? '').toLowerCase();
		const isEnter = keyName === 'enter' || keyName === 'return';
		const isHelpKey = keyName === '?' || (keyName === '/' && key.shift);

		if (key.ctrl && keyName === 'c') {
			quit();
			return;
		}

		const currentState = stateRef.current;

		if (currentState.helpOpen) {
			if (keyName === 'escape' || keyName === 'q' || isHelpKey) {
				dispatch({type: 'CLOSE_HELP'});
			}
			return;
		}

		if (currentState.confirmOpen) {
			if (keyName === 'escape' || keyName === 'n') {
				dispatch({type: 'CLOSE_CONFIRM'});
				return;
			}

			if (keyName === 'y' || isEnter) {
				void performDeletion();
			}
			return;
		}

		if (isHelpKey) {
			dispatch({type: 'TOGGLE_HELP'});
			return;
		}

		if (currentState.focusZone === 'search') {
			if (keyName === 'escape' || isEnter) {
				dispatch({type: 'SET_FOCUS_ZONE', zone: 'list'});
			}
			return;
		}

		if (keyName === '/' && !key.shift) {
			dispatch({type: 'SET_FOCUS_ZONE', zone: 'search'});
			return;
		}

		if (keyName === 'escape' || keyName === 'q') {
			quit();
			return;
		}

		if (keyName === 'down' || keyName === 'j') {
			dispatch({type: 'MOVE_CURSOR', delta: 1, total: visibleItems.length});
			return;
		}

		if (keyName === 'up' || keyName === 'k') {
			dispatch({type: 'MOVE_CURSOR', delta: -1, total: visibleItems.length});
			return;
		}

		if ((keyName === 'g' && !key.shift) || keyName === 'home') {
			dispatch({type: 'SET_CURSOR', index: 0, total: visibleItems.length});
			return;
		}

		if ((keyName === 'g' && key.shift) || keyName === 'end') {
			dispatch({
				type: 'SET_CURSOR',
				index: visibleItems.length - 1,
				total: visibleItems.length,
			});
			return;
		}

		if (keyName === 'space' || keyName === 'x') {
			toggleFocusedSelection();
			return;
		}

		if (keyName === 'a') {
			selectAllVisible();
			return;
		}

		if (keyName === 'c') {
			dispatch({type: 'CLEAR_SELECTION'});
			return;
		}

		if (keyName === 't') {
			dispatch({type: 'CYCLE_SORT'});
			return;
		}

		if (keyName === 'r' && currentState.scanPhase !== 'loading') {
			void runScan();
			return;
		}

		if (keyName === 'n' && key.shift) {
			moveToMatch(-1);
			return;
		}

		if (keyName === 'n') {
			moveToMatch(1);
			return;
		}

		if (keyName === 'd' || isEnter) {
			openDeleteConfirm();
		}
	});

	return (
		<LayoutShell
			terminalWidth={terminalWidth}
			terminalHeight={terminalHeight}
			summary={
				<SummaryStrip
					metrics={metrics}
					scanPhase={state.scanPhase}
					cwd={cwd}
					cleanupScopeLabel={cleanupScopeLabel}
					sortBy={state.sortBy}
					query={state.query}
				/>
			}
			search={
				<SearchBar
					query={state.query}
					focused={state.focusZone === 'search'}
					visibleCount={visibleItems.length}
					totalCount={sortedItems.length}
					onQueryChange={query => dispatch({type: 'SET_QUERY', query})}
					onFocus={() => dispatch({type: 'SET_FOCUS_ZONE', zone: 'search'})}
					onClear={() => dispatch({type: 'SET_QUERY', query: ''})}
				/>
			}
			listPane={
				<CandidateListPane
					items={visibleItems}
					cursorIndex={state.cursorIndex}
					selectedPaths={state.selectedPaths}
					viewStart={viewWindow.start}
					viewEnd={viewWindow.end}
					focused={state.focusZone === 'list'}
					onRowFocus={focusRow}
					onRowToggle={toggleRowSelection}
				/>
			}
			detailsPane={
				<DetailsPane
					item={focusedItem}
					selectedCount={metrics.selectedCount}
					selectedSize={metrics.selectedSize}
					selectedTypeCounts={selectedTypeCounts}
					dryRun={dryRun}
					scanPhase={state.scanPhase}
					sortBy={state.sortBy}
					onRequestDelete={openDeleteConfirm}
					onRescan={() => {
						if (state.scanPhase !== 'loading') {
							void runScan();
						}
					}}
					onCycleSort={() => dispatch({type: 'CYCLE_SORT'})}
				/>
			}
			statusLine={
				<StatusLine focusZone={state.focusZone} status={state.status} />
			}
			overlay={
				state.confirmOpen ? (
					<ConfirmDeleteModal
						count={metrics.selectedCount}
						size={metrics.selectedSize}
						dryRun={dryRun}
						selectedTypeCounts={selectedTypeCounts}
						terminalWidth={terminalWidth}
						terminalHeight={terminalHeight}
					/>
				) : state.helpOpen ? (
					<HelpOverlay
						terminalWidth={terminalWidth}
						terminalHeight={terminalHeight}
					/>
				) : null
			}
		/>
	);
}
