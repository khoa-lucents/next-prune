/** @jsxImportSource @opentui/react */

import type {ShortcutHint} from './types.js';

interface FooterProps {
	shortcuts: ShortcutHint[][];
}

export function Footer({shortcuts}: FooterProps) {
	return (
		<box
			border
			borderStyle="rounded"
			borderColor="gray"
			paddingLeft={1}
			paddingRight={1}
			width="100%"
			flexWrap="wrap"
		>
			{shortcuts.map((group, groupIndex) => (
				<box key={`group-${groupIndex}`} marginRight={2}>
					{group.map((shortcut, shortcutIndex) => (
						<text key={shortcut.key}>
							{shortcutIndex > 0 ? <span fg="gray"> | </span> : null}
							<span fg="cyan">
								<strong>{shortcut.key}</strong>
							</span>{' '}
							<span fg="gray">{shortcut.label}</span>
						</text>
					))}
				</box>
			))}
		</box>
	);
}
