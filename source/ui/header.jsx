import React from 'react';
import {Box, Text} from 'ink';

export function Header() {
	return (
		<Box
			borderStyle="round"
			borderColor="cyan"
			paddingX={1}
			marginBottom={0}
			width="100%"
			justifyContent="center"
		>
			<Text color="cyan" bold>
				🧹 Next Prune
			</Text>
		</Box>
	);
}
