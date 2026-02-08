/** @jsxImportSource @opentui/react */

interface SearchBarProps {
	query: string;
	focused: boolean;
	visibleCount: number;
	totalCount: number;
	terminalWidth: number;
	onQueryChange: (query: string) => void;
	onFocus: () => void;
	onClear: () => void;
}

export function SearchBar({
	query,
	focused,
	visibleCount,
	totalCount,
	terminalWidth,
	onQueryChange,
	onFocus,
	onClear,
}: SearchBarProps) {
	const compact = terminalWidth < 100;
	const canClear = query.length > 0;

	return (
		<box
			border
			borderStyle="rounded"
			borderColor={focused ? 'cyan' : 'gray'}
			title=" Search "
			paddingLeft={1}
			paddingRight={1}
			alignItems="center"
			flexDirection="row"
			gap={1}
			width="100%"
			height={3}
			backgroundColor="black"
			onMouseDown={onFocus}
		>
			{compact ? null : (
				<box width={5} flexShrink={0}>
					<text>
						<span fg="gray">Path</span>
					</text>
				</box>
			)}

			<box flexGrow={1} minWidth={12}>
				<input
					value={query}
					placeholder="filter path..."
					onInput={onQueryChange}
					focused={focused}
					width="100%"
				/>
			</box>

			{compact ? null : (
				<box flexShrink={0} justifyContent="flex-end">
					<text>
						<span fg="gray">
							{visibleCount}/{totalCount}
						</span>
					</text>
				</box>
			)}

			<box flexShrink={0} onMouseDown={canClear ? onClear : undefined}>
				<text>
					<span fg={canClear ? 'yellow' : 'gray'}>
						{compact ? '[c]' : '[c] clear'}
					</span>
				</text>
			</box>
		</box>
	);
}
