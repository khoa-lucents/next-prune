/** @jsxImportSource @opentui/react */

import type {FocusZone, StatusNotice} from '../types.js';

interface StatusLineProps {
	focusZone: FocusZone;
	status: StatusNotice | null;
}

const statusColor = (kind: StatusNotice['kind']): string => {
	if (kind === 'error') return 'red';
	if (kind === 'success') return 'green';
	return 'yellow';
};

const focusLabel = (focusZone: FocusZone): string => {
	if (focusZone === 'search') return 'search';
	if (focusZone === 'confirm') return 'confirm';
	if (focusZone === 'help') return 'help';
	return 'list';
};

const hintText = (focusZone: FocusZone): string => {
	if (focusZone === 'search') return 'Enter: back to list  Esc: back  ?: help';
	if (focusZone === 'confirm') return 'Y/Enter: confirm  N/Esc: cancel';
	if (focusZone === 'help') return 'Q/Esc/?: close help';
	return 'j/k move  space/x select  / search  d delete  t sort  r rescan  ? help  q quit';
};

export function StatusLine({focusZone, status}: StatusLineProps) {
	return (
		<box
			border
			borderStyle="rounded"
			borderColor="gray"
			paddingLeft={1}
			paddingRight={1}
			width="100%"
			flexDirection="row"
			justifyContent="space-between"
			gap={1}
		>
			<text>
				<span fg="gray">Focus:</span>{' '}
				<span fg="cyan">
					<strong>{focusLabel(focusZone)}</strong>
				</span>
			</text>

			<box flexGrow={1}>
				<text>
					<span fg="gray">{hintText(focusZone)}</span>
				</text>
			</box>

			{status ? (
				<text>
					<span fg={statusColor(status.kind)}>{status.message}</span>
				</text>
			) : (
				<text>
					<span fg="gray">Ready</span>
				</text>
			)}
		</box>
	);
}
