/** @jsxImportSource @opentui/react */

interface SearchBarProps {
	query: string;
	focused: boolean;
	visibleCount: number;
	totalCount: number;
	onQueryChange: (query: string) => void;
	onFocus: () => void;
	onClear: () => void;
}

export function SearchBar({
	query,
	focused,
	visibleCount,
	totalCount,
	onQueryChange,
	onFocus,
	onClear,
}: SearchBarProps) {
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
			onMouseDown={onFocus}
		>
			<box width={8}>
				<text>
					<span fg="gray">Path</span>
				</text>
			</box>

			<box flexGrow={1}>
				<input
					value={query}
					placeholder="Type to filter by relative path..."
					onInput={onQueryChange}
					focused={focused}
					width="100%"
				/>
			</box>

			<box width={22} justifyContent="flex-end">
				<text>
					<span fg="gray">
						{visibleCount}/{totalCount} visible
					</span>
				</text>
			</box>

			<box
				border
				borderColor={canClear ? 'yellow' : 'gray'}
				paddingLeft={1}
				paddingRight={1}
				onMouseDown={canClear ? onClear : undefined}
			>
				<text>
					<span fg={canClear ? 'yellow' : 'gray'}>clear</span>
				</text>
			</box>
		</box>
	);
}
