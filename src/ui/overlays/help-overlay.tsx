/** @jsxImportSource @opentui/react */

interface HelpOverlayProps {
	terminalWidth: number;
	terminalHeight: number;
}

export function HelpOverlay({terminalWidth, terminalHeight}: HelpOverlayProps) {
	const modalWidth = Math.max(62, Math.min(92, terminalWidth - 6));
	const modalHeight = Math.max(14, Math.min(22, terminalHeight - 4));

	return (
		<box
			position="absolute"
			left={0}
			top={0}
			width={terminalWidth}
			height={terminalHeight}
			justifyContent="center"
			alignItems="center"
			zIndex={20}
		>
			<box
				width={modalWidth}
				height={modalHeight}
				border
				borderStyle="double"
				borderColor="cyan"
				padding={1}
				flexDirection="column"
				title=" Keyboard & Mouse Help "
			>
				<text>
					<span fg="cyan">
						<strong>Navigation</strong>
					</span>{' '}
					<span fg="gray">j/k or Up/Down, g top, G bottom</span>
				</text>
				<text>
					<span fg="cyan">
						<strong>Selection</strong>
					</span>{' '}
					<span fg="gray">space/x toggle, a select visible, c clear</span>
				</text>
				<text>
					<span fg="cyan">
						<strong>Filtering</strong>
					</span>{' '}
					<span fg="gray">/ focus search, n next match, N previous match</span>
				</text>
				<text>
					<span fg="cyan">
						<strong>Actions</strong>
					</span>{' '}
					<span fg="gray">d or Enter delete, r rescan, t cycle sort</span>
				</text>
				<text>
					<span fg="cyan">
						<strong>Overlays</strong>
					</span>{' '}
					<span fg="gray">? toggle help, q/esc close overlay or quit app</span>
				</text>
				<text>
					<span fg="cyan">
						<strong>Mouse</strong>
					</span>{' '}
					<span fg="gray">
						click row to focus, click marker to toggle, click action boxes
					</span>
				</text>

				<box marginTop={1}>
					<text>
						<span fg="yellow">
							Press <strong>q</strong>, <strong>esc</strong>, or{' '}
							<strong>?</strong> to close this help.
						</span>
					</text>
				</box>
			</box>
		</box>
	);
}
