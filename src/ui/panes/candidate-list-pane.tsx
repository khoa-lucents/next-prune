/** @jsxImportSource @opentui/react */

import {human, timeAgo} from '../../core/format.js';
import type {ArtifactItem, CandidateType} from '../types.js';

interface CandidateListPaneProps {
	items: ArtifactItem[];
	cursorIndex: number;
	selectedPaths: ReadonlySet<string>;
	viewStart: number;
	viewEnd: number;
	focused: boolean;
	maxPathLength: number;
	onRowFocus: (index: number) => void;
	onRowToggle: (index: number) => void;
}

const CANDIDATE_BADGES: Record<CandidateType, {label: string; color: string}> =
	{
		artifact: {label: 'ART', color: 'blue'},
		asset: {label: 'AST', color: 'yellow'},
		node_modules: {label: 'NODE', color: 'magenta'},
		'pm-cache': {label: 'PM', color: 'red'},
	};

const statusToken = (item: ArtifactItem, selected: boolean): string => {
	if (item.status === 'deleting') return '...';
	if (item.status === 'deleted') return 'DEL';
	if (item.status === 'error') return 'ERR';
	if (item.status === 'dry-run') return 'DRY';
	return selected ? '[x]' : '[ ]';
};

const truncatePath = (value: string, maxLength: number): string => {
	if (value.length <= maxLength) return value;
	if (maxLength <= 3) return value.slice(0, maxLength);
	return `${value.slice(0, maxLength - 3)}...`;
};

export function CandidateListPane({
	items,
	cursorIndex,
	selectedPaths,
	viewStart,
	viewEnd,
	focused,
	maxPathLength,
	onRowFocus,
	onRowToggle,
}: CandidateListPaneProps) {
	return (
		<box
			border
			borderStyle="rounded"
			borderColor={focused ? 'cyan' : 'gray'}
			title={` Candidates (${items.length}) `}
			paddingLeft={1}
			paddingRight={1}
			flexDirection="column"
			width="100%"
			height="100%"
			backgroundColor="black"
		>
			<box width="100%" marginBottom={1} flexDirection="row">
				<box width={5}>
					<text>
						<span fg="gray">
							<strong>Sel</strong>
						</span>
					</text>
				</box>
				<box width={10}>
					<text>
						<span fg="gray">
							<strong>Size</strong>
						</span>
					</text>
				</box>
				<box width={8}>
					<text>
						<span fg="gray">
							<strong>Age</strong>
						</span>
					</text>
				</box>
				<box flexGrow={1}>
					<text>
						<span fg="gray">
							<strong>Path</strong>
						</span>
					</text>
				</box>
			</box>

			<box flexDirection="column" flexGrow={1}>
				{items.length === 0 ? (
					<box flexGrow={1} justifyContent="center" alignItems="center">
						<text>
							<span fg="gray">No candidates match current filter.</span>
						</text>
					</box>
				) : (
					items.slice(viewStart, viewEnd).map((item, offset) => {
						const absoluteIndex = viewStart + offset;
						const isFocused = absoluteIndex === cursorIndex;
						const isSelected = selectedPaths.has(item.path);
						const isDeleted = item.status === 'deleted';
						const badge = CANDIDATE_BADGES[item.candidateType];
						const backgroundColor = isFocused ? 'blue' : 'black';
						const textColor = isDeleted
							? 'gray'
							: isFocused
								? 'white'
								: 'white';
						const markerColor = isDeleted
							? 'gray'
							: isSelected
								? 'green'
								: isFocused
									? 'cyan'
									: 'gray';

						return (
							<box
								key={item.path}
								height={1}
								width="100%"
								flexDirection="row"
								backgroundColor={backgroundColor}
								onMouseDown={() => onRowFocus(absoluteIndex)}
							>
								<box width={5} onMouseDown={() => onRowToggle(absoluteIndex)}>
									<text>
										<span fg={markerColor}>
											{statusToken(item, isSelected)}
										</span>
									</text>
								</box>
								<box width={10}>
									<text>
										<span fg={textColor}>{human(item.size)}</span>
									</text>
								</box>
								<box width={8}>
									<text>
										<span fg={textColor}>
											{timeAgo(item.mtime).replace(' ago', '')}
										</span>
									</text>
								</box>
								<box flexGrow={1} overflow="hidden">
									<text>
										<span fg={badge.color}>[{badge.label}]</span>{' '}
										<span fg={textColor}>
											{truncatePath(item.relPath, maxPathLength)}
										</span>
									</text>
								</box>
							</box>
						);
					})
				)}
			</box>
		</box>
	);
}
