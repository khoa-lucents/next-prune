/** @jsxImportSource @opentui/react */

import type {ReactNode} from 'react';

interface LayoutShellProps {
	terminalWidth: number;
	terminalHeight: number;
	summary: ReactNode;
	search: ReactNode;
	listPane: ReactNode;
	detailsPane: ReactNode;
	showDetailsPane?: boolean;
	statusLine: ReactNode;
	overlay?: ReactNode;
}

export function LayoutShell({
	terminalWidth,
	terminalHeight,
	summary,
	search,
	listPane,
	detailsPane,
	showDetailsPane = true,
	statusLine,
	overlay,
}: LayoutShellProps) {
	const compact = terminalWidth < 110;

	return (
		<box
			width={terminalWidth}
			height={terminalHeight}
			padding={1}
			flexDirection="column"
			backgroundColor="black"
		>
			{summary}

			<box marginTop={1}>{search}</box>

			<box
				marginTop={1}
				flexGrow={1}
				flexDirection={compact ? 'column' : 'row'}
				gap={1}
			>
				{compact && !showDetailsPane ? (
					<box flexGrow={1} minHeight={8}>
						{listPane}
					</box>
				) : (
					<>
						<box flexGrow={3} minHeight={8}>
							{listPane}
						</box>
						<box flexGrow={2} minHeight={8}>
							{detailsPane}
						</box>
					</>
				)}
			</box>

			<box marginTop={1}>{statusLine}</box>

			{overlay}
		</box>
	);
}
