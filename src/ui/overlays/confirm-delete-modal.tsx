/** @jsxImportSource @opentui/react */

import {human} from '../../core/format.js';
import type {SelectedTypeCounts} from '../types.js';

interface ConfirmDeleteModalProps {
	count: number;
	size: number;
	dryRun: boolean;
	selectedTypeCounts: SelectedTypeCounts;
	terminalWidth: number;
	terminalHeight: number;
}

export function ConfirmDeleteModal({
	count,
	size,
	dryRun,
	selectedTypeCounts,
	terminalWidth,
	terminalHeight,
}: ConfirmDeleteModalProps) {
	const modalWidth = Math.max(52, Math.min(76, terminalWidth - 4));
	const riskySelectionCount =
		selectedTypeCounts.nodeModules + selectedTypeCounts.pmCaches;
	const needsRiskWarning = riskySelectionCount > 0;

	return (
		<box
			position="absolute"
			left={0}
			top={0}
			width={terminalWidth}
			height={terminalHeight}
			justifyContent="center"
			alignItems="center"
			backgroundColor="black"
			zIndex={30}
		>
			<box
				width={modalWidth}
				border
				borderStyle="double"
				borderColor="yellow"
				padding={1}
				flexDirection="column"
				alignItems="center"
			>
				<text>
					<span fg="yellow">
						<strong>Confirm Deletion</strong>
					</span>
				</text>
				<text>
					Delete <strong>{count}</strong> selected items?
				</text>
				<text>
					Reclaim <strong>{human(size)}</strong>
					{dryRun ? <span fg="blue"> (dry-run)</span> : null}
				</text>
				<text>
					<span fg="blue">ART {selectedTypeCounts.artifact}</span>{' '}
					<span fg="yellow">AST {selectedTypeCounts.asset}</span>{' '}
					<span fg="magenta">NODE {selectedTypeCounts.nodeModules}</span>{' '}
					<span fg="red">PM {selectedTypeCounts.pmCaches}</span>
				</text>
				{needsRiskWarning ? (
					<text>
						<span fg="yellow">
							Node modules / PM caches require <strong>--apply</strong> in
							non-interactive mode.
						</span>
					</text>
				) : null}
				<box marginTop={1}>
					<text>
						<span fg="green">
							<strong>[y]</strong>
						</span>{' '}
						Confirm{' '}
						<span fg="red">
							<strong>[n/esc]</strong>
						</span>{' '}
						Cancel
					</text>
				</box>
			</box>
		</box>
	);
}
