import React from 'react';
import {Box, Text} from 'ink';
import {human} from '../scanner.js';

function Card({label, value, color = 'green', dimLabel = true}) {
	return (
		<Box flexDirection="column" marginRight={4}>
			<Text dimColor={dimLabel}>{label}</Text>
			<Text color={color} bold>
				{value}
			</Text>
		</Box>
	);
}

export function Dashboard({
	foundCount,
	totalSize,
	selectedCount,
	selectedSize,
	loading,
	cwd,
}) {
	return (
		<Box
			borderStyle="round"
			borderColor="blue"
			paddingX={1}
			flexDirection="row"
			justifyContent="space-between"
			width="100%"
		>
			<Box flexDirection="row">
				<Card
					label="Found"
					value={loading ? 'Scanning...' : `${foundCount} items`}
					color={loading ? 'yellow' : 'white'}
				/>
				<Card
					label="Total Size"
					value={loading ? '...' : human(totalSize)}
					color="magenta"
				/>
				<Card
					label="Reclaimable"
					value={human(selectedSize)}
					color={selectedCount > 0 ? 'green' : 'gray'}
				/>
			</Box>
			<Box flexDirection="column" alignItems="flex-end">
				<Text dimColor>Path</Text>
				<Text color="blue">{cwd}</Text>
			</Box>
		</Box>
	);
}
