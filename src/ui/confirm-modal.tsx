/** @jsxImportSource @opentui/react */

import {human} from '../core/format.js';

interface SelectedTypeCounts {
	artifact: number;
	asset: number;
	nodeModules: number;
	pmCaches: number;
}

interface ConfirmModalProps {
	count: number;
	size: number;
	dryRun: boolean;
	selectedTypeCounts: SelectedTypeCounts;
	terminalWidth: number;
	terminalHeight: number;
}

export function ConfirmModal({
	count,
	size,
	dryRun,
	selectedTypeCounts,
	terminalWidth,
	terminalHeight,
}: ConfirmModalProps) {
	const modalWidth = Math.max(44, Math.min(60, terminalWidth - 4));
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
			zIndex={5}
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
					Delete <strong>{count}</strong> items?
				</text>
				<text>
					Reclaim <strong>{human(size)}</strong>
					{dryRun ? <span fg="blue"> (dry-run)</span> : null}
				</text>
				<box marginTop={1}>
					<text>
						<span fg="gray">Types:</span>{' '}
						<span fg="blue">[ART {selectedTypeCounts.artifact}]</span>{' '}
						<span fg="yellow">[AST {selectedTypeCounts.asset}]</span>{' '}
						<span fg="magenta">[NODE {selectedTypeCounts.nodeModules}]</span>{' '}
						<span fg="red">[PM {selectedTypeCounts.pmCaches}]</span>
					</text>
				</box>
				{needsRiskWarning ? (
					<box marginTop={1}>
						<text>
							<span fg="yellow">
								Warning: node_modules and PM caches require
							</span>{' '}
							<span fg="yellow">
								<strong>--apply</strong>
							</span>{' '}
							<span fg="yellow">for non-interactive deletion.</span>
						</text>
					</box>
				) : null}
				<text>
					<span fg="green">
						<strong>[Y]</strong>
					</span>{' '}
					Confirm{' '}
					<span fg="red">
						<strong>[N/Esc]</strong>
					</span>{' '}
					Cancel
				</text>
			</box>
		</box>
	);
}
