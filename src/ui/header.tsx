/** @jsxImportSource @opentui/react */

export function Header() {
	return (
		<box
			border
			borderStyle="rounded"
			borderColor="cyan"
			paddingLeft={1}
			paddingRight={1}
			justifyContent="center"
		>
			<text>
				<span fg="cyan">
					<strong>Next Prune</strong>
				</span>
			</text>
		</box>
	);
}
