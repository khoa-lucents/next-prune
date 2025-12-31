import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs/promises';
import React, {useState, useEffect, useMemo} from 'react';
import {Box, Text, useInput, useApp} from 'ink';
import {scanArtifacts, getArtifactStats, human} from './scanner.js';
import {findUnusedAssets} from './asset-scanner.js';
import {Header} from './ui/header.js';
import {Dashboard} from './ui/dashboard.js';
import {Footer} from './ui/footer.js';
import {ArtifactList} from './ui/artifact-list.js';
import {ConfirmModal} from './ui/confirm-modal.js';

function useTerminalCols() {
	const [cols, setCols] = useState(process.stdout?.columns || 80);
	useEffect(() => {
		const onResize = () => setCols(process.stdout?.columns || 80);
		process.stdout?.on?.('resize', onResize);
		return () => process.stdout?.off?.('resize', onResize);
	}, []);
	return cols;
}

function useTerminalRows() {
	const [rows, setRows] = useState(process.stdout?.rows || 24);
	useEffect(() => {
		const onResize = () => setRows(process.stdout?.rows || 24);
		process.stdout?.on?.('resize', onResize);
		return () => process.stdout?.off?.('resize', onResize);
	}, []);
	return rows;
}

const DEFAULT_CONFIG = {
	alwaysDelete: [],
	neverDelete: [],
	checkUnusedAssets: false,
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
	// selected is now a Set of paths (strings)
	const [selectedPaths, setSelectedPaths] = useState(new Set());
	const [index, setIndex] = useState(0);
	const [sortBy, setSortBy] = useState('size'); // 'size' | 'age' | 'path'
	const [confirm, setConfirm] = useState(false);
	const [error, setError] = useState('');
	// Removed unused showHelp

	// Terminal dimensions
	const cols = useTerminalCols();
	const rows = useTerminalRows();

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

	const totalSize = useMemo(() => {
		return items
			.filter(it => it.status !== 'deleted')
			.reduce((acc, it) => acc + (it.size || 0), 0);
	}, [items]);

	const selectedSize = useMemo(() => {
		return items
			.filter(it => selectedPaths.has(it.path) && it.status !== 'deleted')
			.reduce((acc, it) => acc + (it.size || 0), 0);
	}, [items, selectedPaths]);

	const foundCount = items.filter(it => it.status !== 'deleted').length;

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
	const doScan = async () => {
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
					return !config.neverDelete.some(
						pattern => rel === pattern || rel.startsWith(pattern + path.sep),
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
	};

	const performDeletion = async () => {
		try {
			const pathsToDelete = [...selectedPaths].filter(p => {
				const it = items.find(x => x.path === p);
				return it && it.status !== 'deleted';
			});

			if (pathsToDelete.length === 0) {
				setConfirm(false);
				return;
			}

			if (dryRun) {
				setItems(prev =>
					prev.map(it =>
						pathsToDelete.includes(it.path) ? {...it, status: 'dry-run'} : it,
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
					pathsToDelete.includes(it.path) ? {...it, status: 'deleting'} : it,
				),
			);

			let freed = 0;
			const successes = new Set();

			for (const p of pathsToDelete) {
				try {
					await fs.rm(p, {recursive: true, force: true});
					successes.add(p);
					const it = items.find(x => x.path === p);
					if (it) freed += it.size || 0;
				} catch {
					setItems(prev =>
						prev.map(it => (it.path === p ? {...it, status: 'error'} : it)),
					);
					setError(`Failed to delete: ${p}`);
				}
			}

			// Mark deleted
			if (successes.size > 0) {
				setItems(prev =>
					prev.map(it =>
						successes.has(it.path) ? {...it, status: 'deleted', size: 0} : it,
					),
				);
				setError(`✅ Deleted ${successes.size} items (freed ${human(freed)})`);
			}
		} finally {
			setSelectedPaths(new Set());
			setConfirm(false);
		}
	};

	useInput((input, key) => {
		if (confirm) {
			if (key.escape || input?.toLowerCase() === 'n') setConfirm(false);
			if (input?.toLowerCase() === 'y' || key.return) performDeletion();
			return;
		}

		if (key.escape || input?.toLowerCase() === 'q') exit();

		if (key.upArrow) setIndex(Math.max(0, index - 1));
		if (key.downArrow) setIndex(Math.min(sortedItems.length - 1, index + 1));

		// Page navigation
		if (key.pageUp) setIndex(Math.max(0, index - listBoxHeight));
		if (key.pageDown)
			setIndex(Math.min(sortedItems.length - 1, index + listBoxHeight));
		if (key.home) setIndex(0);
		if (key.end) setIndex(sortedItems.length - 1);

		if (input === ' ') {
			const currentPath = sortedItems[index]?.path;
			if (currentPath && sortedItems[index].status !== 'deleted') {
				setSelectedPaths(prev => {
					const next = new Set(prev);
					if (next.has(currentPath)) next.delete(currentPath);
					else next.add(currentPath);
					return next;
				});
			}
		}

		if (input?.toLowerCase() === 'a') {
			const allPaths = sortedItems
				.filter(it => it.status !== 'deleted')
				.map(it => it.path);
			setSelectedPaths(new Set(allPaths));
		}

		if (input?.toLowerCase() === 'c') setSelectedPaths(new Set());
		if (input?.toLowerCase() === 'r' && !loading) doScan();

		if (input?.toLowerCase() === 's') {
			const modes = ['size', 'age', 'path'];
			const next = modes[(modes.indexOf(sortBy) + 1) % modes.length];
			setSortBy(next);
		}

		if (input?.toLowerCase() === 'd' || key.return) {
			if (selectedPaths.size > 0) {
				setConfirm(true);
			} else if (sortedItems[index]?.status !== 'deleted') {
				// Select current if none selected
				const p = sortedItems[index]?.path;
				if (p) {
					setSelectedPaths(new Set([p]));
					setConfirm(true);
				}
			}
		}
	});

	// Initial scan
	useEffect(() => {
		if (!testMode) doScan();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [cwd, testMode]);

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
				const hit = config.alwaysDelete.some(
					p => rel === p || rel.startsWith(p + path.sep),
				);
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
					selectedIds={
						new Set(
							[...selectedPaths]
								.map(p => {
									// Map path back to current sorted index for display
									return sortedItems.findIndex(it => it.path === p);
								})
								.filter(i => i !== -1),
						)
					}
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
