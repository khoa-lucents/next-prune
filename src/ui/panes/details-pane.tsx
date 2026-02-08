/** @jsxImportSource @opentui/react */

import {human, timeAgo} from '../../core/format.js';
import type {
	ArtifactItem,
	ScanPhase,
	SelectedTypeCounts,
	SortMode,
} from '../types.js';

interface DetailsPaneProps {
	item: ArtifactItem | undefined;
	selectedCount: number;
	selectedSize: number;
	selectedTypeCounts: SelectedTypeCounts;
	dryRun: boolean;
	scanPhase: ScanPhase;
	sortBy: SortMode;
	onRequestDelete: () => void;
	onRescan: () => void;
	onCycleSort: () => void;
}

export function DetailsPane({
	item,
	selectedCount,
	selectedSize,
	selectedTypeCounts,
	dryRun,
	scanPhase,
	sortBy,
	onRequestDelete,
	onRescan,
	onCycleSort,
}: DetailsPaneProps) {
	const riskySelectionCount =
		selectedTypeCounts.nodeModules + selectedTypeCounts.pmCaches;
	const canDelete = selectedCount > 0 || Boolean(item);

	return (
		<box
			border
			borderStyle="rounded"
			borderColor="gray"
			title=" Details & Actions "
			paddingLeft={1}
			paddingRight={1}
			flexDirection="column"
			width="100%"
			height="100%"
			backgroundColor="black"
		>
			<box flexDirection="column" marginBottom={1}>
				<text>
					<span fg="gray">Selection:</span>{' '}
					<span fg={selectedCount > 0 ? 'green' : 'gray'}>
						<strong>
							{selectedCount} ({human(selectedSize)})
						</strong>
					</span>
					{dryRun ? <span fg="blue"> dry-run</span> : null}
				</text>
				<text>
					<span fg="gray">Types:</span>{' '}
					<span fg="blue">[ART {selectedTypeCounts.artifact}]</span>{' '}
					<span fg="yellow">[AST {selectedTypeCounts.asset}]</span>{' '}
					<span fg="magenta">[NODE {selectedTypeCounts.nodeModules}]</span>{' '}
					<span fg="red">[PM {selectedTypeCounts.pmCaches}]</span>
				</text>
				<text>
					<span fg={riskySelectionCount > 0 ? 'yellow' : 'gray'}>
						Risky selected: {riskySelectionCount}
					</span>
				</text>
			</box>

			<box flexDirection="column" marginBottom={1}>
				<box
					border
					borderColor={canDelete ? 'yellow' : 'gray'}
					paddingLeft={1}
					paddingRight={1}
					onMouseDown={canDelete ? onRequestDelete : undefined}
				>
					<text>
						<span fg={canDelete ? 'yellow' : 'gray'}>[d] Delete Selection</span>
					</text>
				</box>
				<box
					border
					borderColor={scanPhase === 'loading' ? 'gray' : 'cyan'}
					paddingLeft={1}
					paddingRight={1}
					onMouseDown={scanPhase === 'loading' ? undefined : onRescan}
				>
					<text>
						<span fg={scanPhase === 'loading' ? 'gray' : 'cyan'}>
							[r] Rescan
						</span>
					</text>
				</box>
				<box
					border
					borderColor="blue"
					paddingLeft={1}
					paddingRight={1}
					onMouseDown={onCycleSort}
				>
					<text>
						<span fg="blue">[t] Sort: {sortBy}</span>
					</text>
				</box>
			</box>

			<box
				border
				borderColor="gray"
				paddingLeft={1}
				paddingRight={1}
				flexGrow={1}
			>
				{item ? (
					<box flexDirection="column">
						<text>
							<span fg="gray">Focused Path</span>
						</text>
						<text>
							<span fg="white">{item.relPath}</span>
						</text>
						<text>
							<span fg="gray">Size:</span>{' '}
							<span fg="magenta">{human(item.size)}</span>
						</text>
						<text>
							<span fg="gray">Age:</span>{' '}
							<span fg="white">{timeAgo(item.mtime)}</span>
						</text>
						<text>
							<span fg="gray">Type:</span>{' '}
							<span fg="white">
								{item.candidateType}
								{item.status ? ` (${item.status})` : ''}
							</span>
						</text>
						{item.candidateType === 'node_modules' ||
						item.candidateType === 'pm-cache' ? (
							<text>
								<span fg="yellow">
									Non-interactive mode requires --apply for this type.
								</span>
							</text>
						) : null}
					</box>
				) : (
					<box flexGrow={1} justifyContent="center" alignItems="center">
						<text>
							<span fg="gray">No focused candidate.</span>
						</text>
					</box>
				)}
			</box>
		</box>
	);
}
