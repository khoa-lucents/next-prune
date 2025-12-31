import React from 'react';
import {Box, Text} from 'ink';
import {human} from '../scanner.js';

export function ConfirmModal({count, size, dryRun}) {
	return (
		<Box
			position="absolute"
			marginTop={10}
			marginLeft={4}
			width={50}
			height={8}
			borderStyle="double"
			borderColor="yellow"
			flexDirection="column"
			alignItems="center"
			justifyContent="center"
			zIndex={1}
		>
			<Text color="yellow" bold>
				⚠️ Confirm Deletion
			</Text>
			<Text>
				Delete <Text bold>{count}</Text> items?
			</Text>
			<Text>
				Reclaim: <Text bold>{human(size)}</Text>
				{Boolean(dryRun) && <Text color="blue"> (Dry Run)</Text>}
			</Text>
			<Box marginTop={1}>
				<Text>
					<Text color="green" bold>
						[Y]
					</Text>{' '}
					Confirm{'  '}
					<Text color="red" bold>
						[N/Esc]
					</Text>{' '}
					Cancel
				</Text>
			</Box>
		</Box>
	);
}
