import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs/promises';
import React, {useState, useEffect, useMemo, useCallback} from 'react';
import {Box, Text, useInput, useApp} from 'ink';
import {scanArtifacts, getArtifactStats, human} from './scanner.js';
import {findUnusedAssets} from './asset-scanner.js';
import {DEFAULT_CONFIG} from './config.js';
import {useTerminalSize} from './hooks/use-terminal-size.js';
import {Header} from './ui/header.js';
import {Dashboard} from './ui/dashboard.js';
import {Footer} from './ui/footer.js';
import {ArtifactList} from './ui/artifact-list.js';
import {ConfirmModal} from './ui/confirm-modal.js';

const toPosixPath = value => value.split(path.sep).join('/');

const matchesConfigPath = (relPath, pattern) => {
	const rel = toPosixPath(relPath);
	const normalizedPattern = String(pattern).replaceAll('\\', '/');
	return rel === normalizedPattern || rel.startsWith(`${normalizedPattern}/`);
};

const SORT_MODES = ['size', 'age', 'path'];

const clampIndex = (nextIndex, totalItems) => {
	if (totalItems <= 0) return 0;
	return Math.max(0, Math.min(totalItems - 1, nextIndex));
};

export default function App({
	cwd = process.cwd(),
	dryRun = false,
	confirmImmediately = false,
	testMode = false,
	config = DEFAULT_CONFIG,
}) {
	const {exit} = useApp();
	const [items, setItems] = useState([]);
	const [loading, setLoading] = useState(!testMode);
	// Selected paths are tracked as a set of absolute paths.
	const [selectedPaths, setSelectedPaths] = useState(new Set());
	const [index, setIndex] = useState(0);
	const [sortBy, setSortBy] = useState('size'); // 'size' | 'age' | 'path'
	const [confirm, setConfirm] = useState(false);
	const [error, setError] = useState('');

	// Terminal dimensions
	const {columns: cols, rows} = useTerminalSize();

	// Derived sorted items
	const sortedItems = useMemo(() => {
		const slice = items.map(it => ({
			...it,
			relPath: path.relative(cwd, it.path) || '.',
		}));

		return slice.sort((a, b) => {
			if (sortBy === 'size') return (b.size || 0) - (a.size || 0);
			if (sortBy === 'age') return new Date(b.mtime) - new Date(a.mtime);
			if (sortBy === 'path') return a.relPath.localeCompare(b.relPath);
			return 0;
		});
	}, [items, sortBy, cwd]);

	const itemByPath = useMemo(
		() => new Map(items.map(it => [it.path, it])),
		[items],
	);

	const {foundCount, totalSize, selectedSize} = useMemo(() => {
		let found = 0;
		let total = 0;
		let selected = 0;

		for (const item of items) {
			if (item.status === 'deleted') continue;

			found++;
			const size = typeof item.size === 'number' ? item.size : 0;
			total += size;
			if (selectedPaths.has(item.path)) {
				selected += size;
			}
		}

		return {foundCount: found, totalSize: total, selectedSize: selected};
	}, [items, selectedPaths]);

	const sortedIndexByPath = useMemo(() => {
		const map = new Map();
		for (const [sortedIndex, item] of sortedItems.entries()) {
			map.set(item.path, sortedIndex);
		}

		return map;
	}, [sortedItems]);

	const selectedIds = useMemo(() => {
		const indices = new Set();
		for (const selectedPath of selectedPaths) {
			const sortedIndex = sortedIndexByPath.get(selectedPath);
			if (sortedIndex !== undefined) {
				indices.add(sortedIndex);
			}
		}

		return indices;
	}, [selectedPaths, sortedIndexByPath]);

	// Viewport Logic
	const listBoxHeight = Math.max(5, (rows || 24) - 12); // Approx height for list
	const viewStart = useMemo(() => {
		const half = Math.floor(listBoxHeight / 2);
		let start = Math.max(0, index - half);
		const end = start + listBoxHeight;
		if (end > sortedItems.length) {
			start = Math.max(0, sortedItems.length - listBoxHeight);
		}

		return start;
	}, [index, listBoxHeight, sortedItems.length]);
	const viewEnd = Math.min(viewStart + listBoxHeight, sortedItems.length);

	// Handlers
	const doScan = useCallback(async () => {
		setLoading(true);
		setError('');
		try {
			let nextItems = await scanArtifacts(cwd);
			if (config.checkUnusedAssets) {
				const assetPaths = await findUnusedAssets(cwd);
				const assetStats = await Promise.all(
					assetPaths.map(p => getArtifactStats(p)),
				);
				const assetItems = assetPaths.map((p, i) => ({
					path: p,
					...assetStats[i],
					type: 'asset',
				}));
				nextItems = [...nextItems, ...assetItems];
			}

			// Filter neverDelete
			if (config.neverDelete?.length > 0) {
				nextItems = nextItems.filter(it => {
					const rel = path.relative(cwd, it.path);
					return !config.neverDelete.some(pattern =>
						matchesConfigPath(rel, pattern),
					);
				});
			}

			setItems(nextItems);
			setIndex(0);
		} catch (error_) {
			setError(String(error_?.message ?? error_));
		} finally {
			setLoading(false);
		}
	}, [cwd, config.checkUnusedAssets, config.neverDelete]);

	const performDeletion = useCallback(async () => {
		try {
			const pathsToDelete = [];
			for (const selectedPath of selectedPaths) {
				const item = itemByPath.get(selectedPath);
				if (item && item.status !== 'deleted') {
					pathsToDelete.push(selectedPath);
				}
			}

			if (pathsToDelete.length === 0) {
				setConfirm(false);
				return;
			}

			const pathsToDeleteSet = new Set(pathsToDelete);

			if (dryRun) {
				setItems(prev =>
					prev.map(it =>
						pathsToDeleteSet.has(it.path) ? {...it, status: 'dry-run'} : it,
					),
				);
				setError(
					`✅ Dry-run: would delete ${
						pathsToDelete.length
					} items (${human(selectedSize)})`,
				);
				setSelectedPaths(new Set());
				setConfirm(false);
				return;
			}

			// Mark deleting
			setItems(prev =>
				prev.map(it =>
					pathsToDeleteSet.has(it.path) ? {...it, status: 'deleting'} : it,
				),
			);

			const deletionResults = await Promise.all(
				pathsToDelete.map(async pathToDelete => {
					try {
						await fs.rm(pathToDelete, {recursive: true, force: true});
						return {path: pathToDelete, ok: true};
					} catch {
						return {path: pathToDelete, ok: false};
					}
				}),
			);

			const succeededPaths = new Set();
			const failedPaths = [];
			let freed = 0;

			for (const result of deletionResults) {
				if (result.ok) {
					succeededPaths.add(result.path);
					const item = itemByPath.get(result.path);
					freed += typeof item?.size === 'number' ? item.size : 0;
				} else {
					failedPaths.push(result.path);
				}
			}

			if (failedPaths.length > 0) {
				const failedPathSet = new Set(failedPaths);
				setItems(prev =>
					prev.map(it =>
						failedPathSet.has(it.path) ? {...it, status: 'error'} : it,
					),
				);
				setError(`Failed to delete: ${failedPaths[0]}`);
			}

			// Mark deleted
			if (succeededPaths.size > 0) {
				setItems(prev =>
					prev.map(it =>
						succeededPaths.has(it.path)
							? {...it, status: 'deleted', size: 0}
							: it,
					),
				);
				setError(
					`✅ Deleted ${succeededPaths.size} items (freed ${human(freed)})`,
				);
			}
		} finally {
			setSelectedPaths(new Set());
			setConfirm(false);
		}
	}, [selectedPaths, itemByPath, dryRun, selectedSize]);

	const moveFocusBy = useCallback(
		delta => {
			setIndex(previous => clampIndex(previous + delta, sortedItems.length));
		},
		[sortedItems.length],
	);

	const jumpFocusTo = useCallback(
		targetIndex => {
			setIndex(clampIndex(targetIndex, sortedItems.length));
		},
		[sortedItems.length],
	);

	const toggleFocusedItemSelection = useCallback(() => {
		const focusedItem = sortedItems[index];
		if (!focusedItem || focusedItem.status === 'deleted') return;

		setSelectedPaths(previous => {
			const next = new Set(previous);
			if (next.has(focusedItem.path)) {
				next.delete(focusedItem.path);
			} else {
				next.add(focusedItem.path);
			}

			return next;
		});
	}, [sortedItems, index]);

	const selectAllItems = useCallback(() => {
		const allPaths = sortedItems
			.filter(it => it.status !== 'deleted')
			.map(it => it.path);
		setSelectedPaths(new Set(allPaths));
	}, [sortedItems]);

	const cycleSortMode = useCallback(() => {
		setSortBy(previous => {
			const nextIndex = (SORT_MODES.indexOf(previous) + 1) % SORT_MODES.length;
			return SORT_MODES[nextIndex];
		});
	}, []);

	const openDeleteConfirmation = useCallback(() => {
		if (selectedPaths.size > 0) {
			setConfirm(true);
			return;
		}

		const focusedItem = sortedItems[index];
		if (!focusedItem || focusedItem.status === 'deleted') return;

		setSelectedPaths(new Set([focusedItem.path]));
		setConfirm(true);
	}, [selectedPaths, sortedItems, index]);

	const handleConfirmInput = useCallback(
		(input, key) => {
			if (!confirm) return false;

			if (key.escape || input?.toLowerCase() === 'n') {
				setConfirm(false);
				return true;
			}

			if (input?.toLowerCase() === 'y' || key.return) {
				performDeletion();
			}

			return true;
		},
		[confirm, performDeletion],
	);

	useInput((input, key) => {
		if (handleConfirmInput(input, key)) return;

		if (key.escape || input?.toLowerCase() === 'q') {
			exit();
			return;
		}

		if (key.upArrow) {
			moveFocusBy(-1);
			return;
		}

		if (key.downArrow) {
			moveFocusBy(1);
			return;
		}

		if (key.pageUp) {
			moveFocusBy(-listBoxHeight);
			return;
		}

		if (key.pageDown) {
			moveFocusBy(listBoxHeight);
			return;
		}

		if (key.home) {
			jumpFocusTo(0);
			return;
		}

		if (key.end) {
			jumpFocusTo(sortedItems.length - 1);
			return;
		}

		if (input === ' ') {
			toggleFocusedItemSelection();
			return;
		}

		const loweredInput = input?.toLowerCase();
		if (loweredInput === 'a') {
			selectAllItems();
			return;
		}

		if (loweredInput === 'c') {
			setSelectedPaths(new Set());
			return;
		}

		if (loweredInput === 'r' && !loading) {
			doScan();
			return;
		}

		if (loweredInput === 's') {
			cycleSortMode();
			return;
		}

		if (loweredInput === 'd' || key.return) {
			openDeleteConfirmation();
		}
	});

	// Initial scan
	useEffect(() => {
		if (!testMode) doScan();
	}, [testMode, doScan]);

	// Auto-select based on config
	useEffect(() => {
		if (items.length === 0 || testMode) return;

		if (confirmImmediately) {
			const all = items.map(it => it.path);
			setSelectedPaths(new Set(all));
			setConfirm(true);
			return;
		}

		if (config.alwaysDelete?.length > 0) {
			const pre = new Set();
			for (const it of items) {
				const rel = path.relative(cwd, it.path);
				const hit = config.alwaysDelete.some(p => matchesConfigPath(rel, p));
				if (hit && it.status !== 'deleted') pre.add(it.path);
			}

			if (pre.size > 0) setSelectedPaths(pre);
		}
	}, [confirmImmediately, items, config.alwaysDelete, cwd, testMode]);

	const shortcuts = [
		[
			{key: '↑↓', label: 'move'},
			{key: 'Space', label: 'select'},
			{key: 'A', label: 'all'},
		],
		[
			{key: 'S', label: `sort (${sortBy})`},
			{key: 'D/Enter', label: 'delete'},
			{key: 'Q', label: 'quit'},
		],
	];

	return (
		<Box flexDirection="column" padding={1} height={rows} width={cols}>
			<Header />

			<Box marginTop={1} marginBottom={1}>
				<Dashboard
					foundCount={foundCount}
					totalSize={totalSize}
					selectedCount={selectedPaths.size}
					selectedSize={selectedSize}
					loading={loading}
					cwd={cwd}
				/>
			</Box>

			{/* Main Content Area */}
			<Box
				flexGrow={1}
				borderStyle="round"
				borderColor={selectedPaths.size > 0 ? 'yellow' : 'gray'}
				paddingX={1}
				flexDirection="column"
			>
				{Boolean(error) && (
					<Box borderStyle="single" borderColor="red" marginBottom={1}>
						<Text color="red">{error}</Text>
					</Box>
				)}

				<ArtifactList
					items={sortedItems}
					selectedIndex={index}
					selectedIds={selectedIds}
					viewStart={viewStart}
					viewEnd={viewEnd}
					cwd={cwd}
					height={listBoxHeight}
				/>
			</Box>

			<Box marginTop={0}>
				<Footer shortcuts={shortcuts} />
			</Box>

			{Boolean(confirm) && (
				<ConfirmModal
					count={selectedPaths.size}
					size={selectedSize}
					dryRun={dryRun}
				/>
			)}
		</Box>
	);
}
