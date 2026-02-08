/** @jsxImportSource @opentui/react */

import type {FocusZone, StatusNotice} from '../types.js';

interface StatusLineProps {
	focusZone: FocusZone;
	status: StatusNotice | null;
	terminalWidth: number;
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

const compactHintText = (
	focusZone: FocusZone,
	terminalWidth: number,
): string => {
	if (focusZone !== 'list') return hintText(focusZone);

	if (terminalWidth < 100) {
		return 'j/k move  space select  / search  d delete  ? help';
	}

	if (terminalWidth < 130) {
		return 'j/k move  space/x select  / search  d delete  t sort  ? help';
	}

	return hintText(focusZone);
};

const truncate = (value: string, maxChars: number): string => {
	if (value.length <= maxChars) return value;
	if (maxChars <= 3) return value.slice(0, maxChars);
	return `${value.slice(0, maxChars - 3)}...`;
};

export function StatusLine({
	focusZone,
	status,
	terminalWidth,
}: StatusLineProps) {
	const hint = compactHintText(focusZone, terminalWidth);
	const rawStatus = status ? status.message : 'Ready';
	const statusTextValue = truncate(rawStatus, terminalWidth < 100 ? 18 : 30);

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
			height={3}
			backgroundColor="black"
		>
			<box flexShrink={0}>
				<text>
					<span fg="gray">Focus:</span>{' '}
					<span fg="cyan">
						<strong>{focusLabel(focusZone)}</strong>
					</span>
				</text>
			</box>

			<box flexGrow={1} overflow="hidden">
				<text>
					<span fg="gray">{hint}</span>
				</text>
			</box>

			<box flexShrink={0}>
				<text>
					<span fg={status ? statusColor(status.kind) : 'gray'}>
						{statusTextValue}
					</span>
				</text>
			</box>
		</box>
	);
}
