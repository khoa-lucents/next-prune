import React from 'react';
import {Box, Text} from 'ink';

const EMPTY_SHORTCUTS = [];

export function Footer({shortcuts = EMPTY_SHORTCUTS}) {
	return (
		<Box borderStyle="round" borderColor="gray" paddingX={1} width="100%">
			{shortcuts.map((group, i) => (
				<Box key={i} marginRight={2}>
					{group.map((s, j) => (
						<Text key={s.key}>
							{j > 0 && <Text dimColor> • </Text>}
							<Text color="cyan" bold>
								{s.key}
							</Text>{' '}
							<Text dimColor>{s.label}</Text>
						</Text>
					))}
				</Box>
			))}
		</Box>
	);
}
