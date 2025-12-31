import React from 'react';
import {Box, Text} from 'ink';
import {human, timeAgo} from '../scanner.js';

function Column({width, children, align = 'flex-start'}) {
	return (
		<Box width={width} justifyContent={align} marginRight={1}>
			{children}
		</Box>
	);
}

function Row({it, isSelected, isFocused, isDeleted}) {
	const icon = it.isDirectory ? '📁' : '📄';
	const typeIcon = it.type === 'asset' ? '⚠️ ' : '';
	const check = isSelected ? '◉' : '○';

	let statusText = '';
	if (it.status === 'deleting') statusText = '🗑️';
	if (it.status === 'deleted') statusText = '✅';
	if (it.status === 'error') statusText = '❌';
	if (it.status === 'dry-run') statusText = '🔍';

	const textColor = isDeleted ? 'gray' : isFocused ? 'black' : 'white';
	const bgColor = isFocused ? (isDeleted ? 'gray' : 'cyan') : undefined;

	return (
		<Box width="100%" height={1}>
			<Box backgroundColor={bgColor} width="100%">
				<Box width={3} justifyContent="center" marginRight={1}>
					<Text color={isDeleted ? 'gray' : isSelected ? 'green' : 'gray'}>
						{statusText || check}
					</Text>
				</Box>

				<Column width={10} align="flex-end">
					<Text color={textColor} dimColor={isDeleted}>
						{it.size === undefined ? '...' : human(it.size)}
					</Text>
				</Column>

				<Column width={10} align="flex-end">
					<Text color={textColor} dimColor>
						{timeAgo(it.mtime).replace(' ago', '')}
					</Text>
				</Column>

				<Box flexGrow={1}>
					<Text color={textColor} dimColor={isDeleted} wrap="truncate-middle">
						{typeIcon}
						{icon} {it.relPath}
					</Text>
				</Box>
			</Box>
		</Box>
	);
}

export function ArtifactList({
	items,
	selectedIndex,
	selectedIds, // Set of indices
	viewStart,
	viewEnd,
	height,
}) {
	return (
		<Box flexDirection="column" height={height} width="100%">
			{/* Table Header */}
			<Box
				borderStyle="single"
				borderBottom
				borderTop={false}
				borderLeft={false}
				borderRight={false}
				borderColor="gray"
				width="100%"
				marginBottom={0}
			>
				<Box width={3} marginRight={1} />
				<Column width={10} align="flex-end">
					<Text dimColor bold>
						Size
					</Text>
				</Column>
				<Column width={10} align="flex-end">
					<Text dimColor bold>
						Age
					</Text>
				</Column>
				<Box flexGrow={1}>
					<Text dimColor bold>
						Path
					</Text>
				</Box>
			</Box>

			{/* List */}
			<Box flexDirection="column" flexGrow={1}>
				{items.length === 0 ? (
					<Box
						height="100%"
						width="100%"
						justifyContent="center"
						alignItems="center"
					>
						<Text dimColor>No artifacts found.</Text>
					</Box>
				) : (
					items.slice(viewStart, viewEnd).map((it, i) => {
						const actualIndex = viewStart + i;
						return (
							<Row
								key={it.path}
								it={it}
								isSelected={selectedIds.has(actualIndex)}
								isFocused={actualIndex === selectedIndex}
								isDeleted={it.status === 'deleted'}
							/>
						);
					})
				)}
			</Box>
		</Box>
	);
}
