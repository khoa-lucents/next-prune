/** @jsxImportSource @opentui/react */

import {human} from '../../core/format.js';
import type {Metrics, ScanPhase, SortMode} from '../types.js';

interface SummaryStripProps {
	metrics: Metrics;
	scanPhase: ScanPhase;
	cleanupScopeLabel: string;
	sortBy: SortMode;
	query: string;
	terminalWidth: number;
}

const statusText = (scanPhase: ScanPhase): string => {
	if (scanPhase === 'loading') return 'Scanning';
	if (scanPhase === 'error') return 'ScanFailed';
	return 'Ready';
};

const statusColor = (scanPhase: ScanPhase): string => {
	if (scanPhase === 'loading') return 'yellow';
	if (scanPhase === 'error') return 'red';
	return 'green';
};

const truncate = (value: string, limit: number): string => {
	if (value.length <= limit) return value;
	if (limit <= 3) return value.slice(0, limit);
	return `${value.slice(0, limit - 3)}...`;
};

export function SummaryStrip({
	metrics,
	scanPhase,
	cleanupScopeLabel,
	sortBy,
	query,
	terminalWidth,
}: SummaryStripProps) {
	const compact = terminalWidth < 100;
	const riskyCount = metrics.nodeModulesCount + metrics.pmCachesCount;
	const filterLabel = query.length > 0 ? query : 'none';
	const scopeLabel = truncate(cleanupScopeLabel, compact ? 16 : 24);
	const filterShort = truncate(filterLabel, compact ? 14 : 20);

	const lineOne = compact
		? `Status ${statusText(scanPhase)} | Scope ${scopeLabel}`
		: `Status ${statusText(scanPhase)} | Scope ${scopeLabel} | Sort ${sortBy} | Filter ${filterShort}`;
	const lineTwo = compact
		? `Found ${metrics.foundCount} | Sel ${metrics.selectedCount} (${human(metrics.selectedSize)}) | Risky ${riskyCount}`
		: `Found ${metrics.foundCount} | Total ${human(metrics.totalSize)} | Selected ${metrics.selectedCount} (${human(metrics.selectedSize)}) | Risky ${riskyCount}`;

	return (
		<box
			border
			borderStyle="rounded"
			borderColor="cyan"
			title=" Next Prune Command Center "
			titleAlignment="center"
			paddingLeft={1}
			paddingRight={1}
			flexDirection="column"
			width="100%"
			height={4}
			backgroundColor="black"
		>
			<box height={1}>
				<text>
					<span fg={statusColor(scanPhase)}>{lineOne}</span>
				</text>
			</box>
			<box height={1}>
				<text>
					<span fg="gray">{lineTwo}</span>
				</text>
			</box>
		</box>
	);
}
