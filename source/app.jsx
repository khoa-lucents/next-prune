import process from 'node:process';
import path from 'node:path';
import fs from 'node:fs/promises';

import React, {useState, useEffect, useMemo} from 'react';
import {Box, Text, useInput, useApp} from 'ink';
import {findNextCaches, getDirSize, FRAMES, human} from './scanner.js';

// Scanner utilities are imported from ./scanner.js

function useSpinner(active) {
	const [i, setI] = useState(0);
	useEffect(() => {
		if (!active) return;
		const t = setInterval(() => setI(x => (x + 1) % FRAMES.length), 80);
		return () => clearInterval(t);
	}, [active]);
	return FRAMES[i];
}

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

// Greedy pack segments into up to maxLines based on terminal width
function packSegments(segments, cols, maxLines = 3) {
	const sep = ' • ';
	const prefixLen = 3; // approx width of '🎮 '
	const max = Math.max(24, (cols || 80) - 6); // leave room for borders/padding
	const lines = [];
	let cur = [];
	let curLen = prefixLen; // first line has a small prefix
	const pushLine = () => {
		if (cur.length > 0) lines.push(cur);
		cur = [];
		curLen = 0;
	};

	for (const seg of segments) {
		const segText = `${seg.key} ${seg.label}`;
		const addLen = (cur.length === 0 ? 0 : sep.length) + segText.length;
		const isLastLine = lines.length >= maxLines - 1;
		if (!isLastLine && cur.length > 0 && curLen + addLen > max) {
			pushLine();
		}
		cur.push(seg);
		curLen += cur.length === 1 ? segText.length : addLen;
	}

	if (cur.length > 0) lines.push(cur);
	return lines.slice(0, maxLines);
}

// Similar to packSegments but for {label, value} pairs
function packLabeledSegments(segments, cols, prefixLen = 0, maxLines = 3) {
	const sepLen = 3; // ' • '
	const max = Math.max(24, (cols || 80) - 6);
	const lines = [];
	let cur = [];
	let curLen = prefixLen;
	const pushLine = () => {
		if (cur.length > 0) lines.push(cur);
		cur = [];
		curLen = 0;
	};

	for (const seg of segments) {
		const segLen = seg.label.length + 1 + String(seg.value).length; // space before value
		const addLen = (cur.length === 0 ? 0 : sepLen) + segLen;
		if (cur.length > 0 && curLen + addLen > max) {
			pushLine();
		}
		cur.push(seg);
		curLen += cur.length === 1 ? segLen : addLen;
	}

	if (cur.length > 0) lines.push(cur);
	return lines.slice(0, maxLines);
}

function truncateMiddle(text, max) {
	if (!text) return '';
	if (max <= 0) return '';
	if (text.length <= max) return text;
	if (max <= 1) return '…';
	const head = Math.ceil((max - 1) / 2);
	const tail = Math.floor((max - 1) / 2);
	return text.slice(0, head) + '…' + text.slice(text.length - tail);
}

export default function App({
	cwd = process.cwd(),
	dryRun = false,
	confirmImmediately = false,
	testMode = false,
}) {
	const {exit} = useApp();
	const [items, setItems] = useState([]); // {path, size, status}
	const [loading, setLoading] = useState(!testMode);
	const [selected, setSelected] = useState(new Set());
	const [index, setIndex] = useState(0);
	const [confirm, setConfirm] = useState(false);
	const [error, setError] = useState('');
	const [showHelp, setShowHelp] = useState(false);
	const spinner = useSpinner(loading);
	const cols = useTerminalCols();
	const rows = useTerminalRows();
	const hasSelection = selected.size > 0;

	const footerSegments = useMemo(() => {
		if (hasSelection) {
			return [
				{key: 'Space', label: 'toggle'},
				{key: 'D/Enter', label: 'delete'},
				{key: 'C', label: 'clear'},
				{key: 'H', label: 'help'},
				{key: 'Q', label: 'quit'},
			];
		}
		return [
			{key: '↑↓', label: 'move'},
			{key: 'Space', label: 'select'},
			{key: 'A', label: 'all'},
			{key: 'R', label: 'rescan'},
			{key: 'H', label: 'help'},
			{key: 'Q', label: 'quit'},
		];
	}, [hasSelection]);

	const packedLines = useMemo(
		() => packSegments(footerSegments, cols, 3),
		[footerSegments, cols],
	);

	const totalSize = useMemo(() => {
		let sum = 0;
		for (const it of items) {
			if (it.status !== 'deleted') {
				sum += typeof it.size === 'number' ? it.size : 0;
			}
		}
		return sum;
	}, [items]);

	const selectedSize = useMemo(() => {
		let sum = 0;
		let idx = 0;
		for (const it of items) {
			if (selected.has(idx)) sum += typeof it.size === 'number' ? it.size : 0;
			idx += 1;
		}

		return sum;
	}, [items, selected]);

	const foundCount = useMemo(
		() => items.filter(it => it.status !== 'deleted').length,
		[items],
	);

	const truncatedCwd = useMemo(() => {
		const labelLen = 'Scan Directory:'.length;
		const max = Math.max(10, (cols || 80) - labelLen - 6);
		return truncateMiddle(cwd, max);
	}, [cwd, cols]);

	const scanSegments = useMemo(() => {
		const segs = [
			{label: 'Found:', value: `${foundCount} directories`},
			{label: 'Total Size:', value: human(totalSize)},
			{label: 'Selected:', value: `${selected.size} (${human(selectedSize)})`},
		];
		if (loading) segs.push({label: 'Status:', value: `${spinner} scanning...`});
		return segs;
	}, [foundCount, totalSize, selected.size, selectedSize, loading, spinner]);
	const packedScan = useMemo(
		() => packLabeledSegments(scanSegments, cols, 0, 3),
		[scanSegments, cols],
	);

	// Trigger a (re)scan
	const doScan = async () => {
		setLoading(true);
		setError('');
		try {
			const paths = await findNextCaches(cwd);
			const sizes = await Promise.all(paths.map(p => getDirSize(p)));
			const nextItems = [];
			for (let i = 0; i < paths.length; i += 1)
				nextItems.push({path: paths[i], size: sizes[i]});
			setItems(nextItems);
			// Reset UI focus/help after a fresh scan
			setIndex(0);
			setShowHelp(false);
		} catch (error_) {
			setError(String(error_?.message ?? error_));
		} finally {
			setLoading(false);
		}
	};

	// Deletion handler: performs dry-run or actual deletion for selected items
	const performDeletion = async () => {
		try {
			const selectedIndices = [...selected].filter(
				i => items[i]?.status !== 'deleted',
			);
			if (selectedIndices.length === 0) {
				setConfirm(false);
				return;
			}
			if (dryRun) {
				setItems(prev =>
					prev.map((it, i) =>
						selectedIndices.includes(i) ? {...it, status: 'dry-run'} : it,
					),
				);
				setError(
					`✅ Dry-run: would delete ${
						selectedIndices.length
					} directories (${human(selectedSize)})`,
				);
				setSelected(new Set());
				setConfirm(false);
				return;
			}

			// Mark as deleting
			setItems(prev =>
				prev.map((it, i) =>
					selectedIndices.includes(i) ? {...it, status: 'deleting'} : it,
				),
			);
			const snapshot = items;
			let freed = 0;
			const successes = new Set();
			for (const i of selectedIndices) {
				const p = snapshot[i]?.path;
				try {
					if (p) {
						await fs.rm(p, {recursive: true, force: true});
						successes.add(i);
						const s = snapshot[i]?.size;
						freed += typeof s === 'number' ? s : 0;
					}
				} catch (error_) {
					// Mark error for this item
					setItems(prev =>
						prev.map((it, j) => (j === i ? {...it, status: 'error'} : it)),
					);
					setError(`Failed to delete: ${p} (${error_?.message ?? error_})`);
				}
			}
			// Mark successful deletions
			if (successes.size > 0) {
				setItems(prev =>
					prev.map((it, i) =>
						successes.has(i) ? {...it, status: 'deleted', size: 0} : it,
					),
				);
				setError(
					`✅ Deleted ${successes.size} directories (freed ${human(freed)})`,
				);
			}
		} finally {
			setSelected(new Set());
			setConfirm(false);
		}
	};

	// Basic input handling keeps stdin listener active so the app doesn't exit after scanning
	useInput((input, key) => {
		// Handle confirmation modal first
		if (confirm) {
			if (key.escape || input?.toLowerCase() === 'n') {
				setConfirm(false);
				return;
			}
			if (input?.toLowerCase() === 'y') {
				performDeletion();
				return;
			}
			return;
		}
		// Global Quit
		if (
			key.escape ||
			input?.toLowerCase() === 'q' ||
			(input === 'c' && key.ctrl)
		) {
			exit();
		} else if (input === 'h' || input === '?') {
			// Toggle Help
			setShowHelp(v => !v);
		} else if (key.upArrow) {
			// Navigate Up
			setIndex(i => Math.max(0, i - 1));
		} else if (key.downArrow) {
			// Navigate Down
			setIndex(i => Math.min(Math.max(0, items.length - 1), i + 1));
		} else if (input === ' ') {
			// Selection Toggle
			setSelected(cur => {
				const next = new Set(cur);
				if (next.has(index)) next.delete(index);
				else if (items[index]?.status !== 'deleted') next.add(index);
				return next;
			});
		} else if (input === 'a') {
			// Select All
			setSelected(
				new Set(
					items.map((_, i) => i).filter(i => items[i]?.status !== 'deleted'),
				),
			);
		} else if (input === 'c') {
			// Clear Selection
			setSelected(new Set());
		} else if (input?.toLowerCase() === 'd' || key.return) {
			// Open confirm; if none selected, select the focused item if allowed
			if (selected.size > 0) {
				setConfirm(true);
			} else if (items[index]?.status !== 'deleted') {
				setSelected(new Set([index]));
				setConfirm(true);
			}
		} else if (input?.toLowerCase() === 'r' && !loading) {
			// Rescan
			doScan();
		}
	});

	// Viewport sizing to avoid terminal jumping on navigation
	const {listBoxHeight, viewStart, viewEnd} = useMemo(() => {
		const rootPad = 2; // root <Box padding={1}> adds 2 rows total
		const titleHeight = 5; // round border + padding + 1 line
		const scanHeight = 5 + packedScan.length; // single border + padding + header + lines
		const errorHeight = error ? 5 : 0; // approx single-line error box
		const footerHeight = showHelp ? 10 : 4 + packedLines.length; // help ~6 lines + borders/padding => 10; else compact footer
		const confirmHeight = confirm ? 7 : 0; // confirm box ~3 lines + borders/padding
		const used =
			rootPad +
			titleHeight +
			scanHeight +
			errorHeight +
			footerHeight +
			confirmHeight;
		const totalRows = rows || 24;
		const boxHeight = Math.max(7, totalRows - used); // include list borders+padding
		const inner = Math.max(3, boxHeight - 4); // subtract list border+padding

		// Center the focused item within the visible window when possible
		const half = Math.floor(inner / 2);
		let start = Math.max(0, index - half);
		let end = start + inner;
		if (end > items.length) {
			end = items.length;
			start = Math.max(0, end - inner);
		}

		return {
			listBoxHeight: boxHeight,
			viewStart: start,
			viewEnd: end,
		};
	}, [
		rows,
		packedScan.length,
		error,
		showHelp,
		packedLines.length,
		confirm,
		index,
		items.length,
	]);

	useEffect(() => {
		if (testMode) return;
		doScan();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [cwd, testMode]);

	useEffect(() => {
		if (!confirmImmediately) return;
		if (testMode) return;
		if (items.length === 0) return;
		setSelected(new Set(items.map((_, i) => i)));
		setConfirm(true);
	}, [confirmImmediately, items, testMode]);

	// Auto-deselect deleted items
	useEffect(() => {
		setSelected(cur => {
			const next = new Set();
			for (const i of cur) {
				if (items[i]?.status === 'deleted') {
					continue;
				}
				next.add(i);
			}
			if (next.size === cur.size) {
				return cur;
			}
			return next;
		});
	}, [items]);

	return (
		<Box flexDirection="column" padding={1}>
			<Box borderStyle="round" borderColor="green" padding={1} marginBottom={1}>
				<Text color="green" bold>
					🌿 Next Prune
				</Text>
			</Box>

			<Box borderStyle="single" borderColor="gray" padding={1} marginBottom={1}>
				<Box flexDirection="column">
					<Box>
						<Text color="cyan">Scan Directory:</Text>
						<Text> {truncatedCwd}</Text>
					</Box>
					<Box marginTop={1} flexDirection="column">
						{packedScan.map((line, li) => (
							<Box key={li}>
								{line.map((seg, si) => (
									<React.Fragment key={si}>
										<Text color={seg.label === 'Status:' ? 'blue' : 'yellow'}>
											{seg.label}
										</Text>
										<Text> {seg.value}</Text>
										{si < line.length - 1 && <Text> • </Text>}
									</React.Fragment>
								))}
							</Box>
						))}
					</Box>
				</Box>
			</Box>

			{error && (
				<Box
					borderStyle="single"
					borderColor={error.startsWith('✅') ? 'green' : 'red'}
					padding={1}
					marginBottom={1}
				>
					{error.startsWith('✅') ? (
						<Text color="green" bold>
							{error}
						</Text>
					) : (
						<>
							<Text color="red" bold>
								❌ Error:{' '}
							</Text>
							<Text color="red">{error}</Text>
						</>
					)}
				</Box>
			)}

			<Box
				flexDirection="column"
				borderStyle="single"
				padding={1}
				height={listBoxHeight}
			>
				{items.length === 0 && !loading ? (
					<Box justifyContent="center" alignItems="center" minHeight={5}>
						<Text color="green">
							✅ No build artifacts found - your project is clean!
						</Text>
					</Box>
				) : (
					items.slice(viewStart, viewEnd).map((it, offset) => {
						const i = viewStart + offset;
						const rel = path.relative(cwd, it.path) || '.';
						const isSel = selected.has(i);
						const isFocus = i === index;
						const prefix = isFocus ? '>' : ' ';
						const mark = isSel ? '[x]' : '[ ]';
						const sizeText =
							it.size === undefined || it.size === null ? '…' : human(it.size);

						let statusColor = undefined;
						let statusText = '';
						if (it.status === 'deleted') {
							// No inline indicator for deleted items; styling conveys state
						} else if (it.status === 'error') {
							statusColor = 'red';
							statusText = ' ❌ error';
						} else if (it.status === 'dry-run') {
							statusColor = 'yellow';
							statusText = ' 🔍 dry-run';
						} else if (it.status === 'deleting') {
							statusColor = 'blue';
							statusText = ' 🗑️ deleting...';
						}

						// Ensure single-line rendering to avoid terminal scroll jumps
						const containerWidth = Math.max(24, (cols || 80) - 6);
						const leftPart = `${prefix} ${mark} ${sizeText.padStart(7)} `;
						const reserved =
							leftPart.length + (statusText ? statusText.length : 0);
						const maxRel = Math.max(3, containerWidth - reserved);
						const displayRel = truncateMiddle(rel, maxRel);

						return (
							<Box key={it.path}>
								<Text
									color={
										it.status === 'deleted'
											? 'gray'
											: isFocus
											? 'cyan'
											: undefined
									}
									backgroundColor={
										isFocus && it.status !== 'deleted' ? 'blue' : undefined
									}
									dimColor={it.status === 'deleted'}
									strikethrough={it.status === 'deleted'}
								>
									{leftPart}
									{displayRel}
								</Text>
								{statusText && <Text color={statusColor}>{statusText}</Text>}
							</Box>
						);
					})
				)}
			</Box>

			<Box borderStyle="single" borderColor="gray" padding={1} marginTop={1}>
				{showHelp ? (
					<Box flexDirection="column">
						<Box>
							<Text color="cyan" bold>
								📖 Help
							</Text>
							<Text> </Text>
							<Text dimColor>(Esc to close)</Text>
						</Box>
						<Box>
							<Box flexDirection="column" marginRight={2}>
								<Text dimColor>Navigation</Text>
								<Text>
									<Text color="cyan">↑↓</Text>
									<Text dimColor> move • </Text>
									<Text color="cyan">Home/End</Text>
									<Text dimColor> jump • </Text>
									<Text color="cyan">PgUp/PgDn</Text>
									<Text dimColor> page</Text>
								</Text>
								<Text></Text>
								<Text dimColor>Selection</Text>
								<Text>
									<Text color="cyan">Space</Text>
									<Text dimColor> select • </Text>
									<Text color="cyan">A</Text>
									<Text dimColor> all • </Text>
									<Text color="cyan">C</Text>
									<Text dimColor> clear</Text>
								</Text>
							</Box>
							<Box flexDirection="column">
								<Text dimColor>Actions</Text>
								<Text>
									<Text color="cyan">D/Enter</Text>
									<Text dimColor> delete • </Text>
									<Text color="cyan">R</Text>
									<Text dimColor> rescan</Text>
								</Text>
								<Text></Text>
								<Text dimColor>App</Text>
								<Text>
									<Text color="cyan">H/?</Text>
									<Text dimColor> help • </Text>
									<Text color="cyan">Q</Text>
									<Text dimColor> quit</Text>
								</Text>
							</Box>
						</Box>
					</Box>
				) : (
					<Box flexDirection="column">
						{packedLines.map((line, li) => (
							<Box key={li}>
								{li === 0 && <Text dimColor>🎮 </Text>}
								{line.map((seg, si) => (
									<React.Fragment key={si}>
										<Text color="cyan">{seg.key}</Text>
										<Text dimColor> {seg.label}</Text>
										{si < line.length - 1 && <Text dimColor> • </Text>}
									</React.Fragment>
								))}
							</Box>
						))}
					</Box>
				)}
			</Box>

			{confirm && (
				<Box
					borderStyle="double"
					borderColor="yellow"
					padding={1}
					marginTop={1}
				>
					<Text color="yellow" bold>
						⚠️ Confirm Deletion
					</Text>
					<Text>
						Delete {selected.size} directories ({human(selectedSize)})
						{dryRun ? ' [dry-run mode]' : ''}?
					</Text>
					<Box marginTop={1}>
						<Text color="green" bold>
							[Y]es
						</Text>
						<Text> • </Text>
						<Text color="red" bold>
							[N]o
						</Text>
						<Text> • </Text>
						<Text color="gray" bold>
							Esc
						</Text>
						<Text color="gray"> cancel</Text>
					</Box>
				</Box>
			)}
		</Box>
	);
}
