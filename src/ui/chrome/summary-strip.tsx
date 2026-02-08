/** @jsxImportSource @opentui/react */

import {human} from '../../core/format.js';
import type {Metrics, ScanPhase, SortMode} from '../types.js';

interface SummaryStripProps {
	metrics: Metrics;
	scanPhase: ScanPhase;
	cwd: string;
	cleanupScopeLabel: string;
	sortBy: SortMode;
	query: string;
}

const statusText = (scanPhase: ScanPhase): string => {
	if (scanPhase === 'loading') return 'Scanning...';
	if (scanPhase === 'error') return 'Scan failed';
	return 'Ready';
};

const statusColor = (scanPhase: ScanPhase): string => {
	if (scanPhase === 'loading') return 'yellow';
	if (scanPhase === 'error') return 'red';
	return 'green';
};

export function SummaryStrip({
	metrics,
	scanPhase,
	cwd,
	cleanupScopeLabel,
	sortBy,
	query,
}: SummaryStripProps) {
	const riskyCount = metrics.nodeModulesCount + metrics.pmCachesCount;

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
		>
			<text>
				<span fg="gray">Status:</span>{' '}
				<span fg={statusColor(scanPhase)}>
					<strong>{statusText(scanPhase)}</strong>
				</span>{' '}
				<span fg="gray">| Found:</span>{' '}
				<span fg="white">
					<strong>{metrics.foundCount}</strong>
				</span>{' '}
				<span fg="gray">| Total:</span>{' '}
				<span fg="magenta">
					<strong>{human(metrics.totalSize)}</strong>
				</span>{' '}
				<span fg="gray">| Selected:</span>{' '}
				<span fg={metrics.selectedCount > 0 ? 'green' : 'gray'}>
					<strong>
						{metrics.selectedCount} ({human(metrics.selectedSize)})
					</strong>
				</span>{' '}
				<span fg="gray">| Risky:</span>{' '}
				<span fg={riskyCount > 0 ? 'yellow' : 'gray'}>
					<strong>{riskyCount}</strong>
				</span>
			</text>

			<text>
				<span fg="gray">Scope:</span> <span fg="blue">{cleanupScopeLabel}</span>{' '}
				<span fg="gray">| Sort:</span> <span fg="cyan">{sortBy}</span>{' '}
				<span fg="gray">| Filter:</span>{' '}
				<span fg={query ? 'yellow' : 'gray'}>{query || 'none'}</span>
			</text>

			<text>
				<span fg="gray">Root:</span> <span fg="blue">{cwd}</span>
			</text>
		</box>
	);
}
