/** @jsxImportSource @opentui/react */

import {human, timeAgo} from '../core/format.js';
import type {ArtifactItem, CandidateType} from './types.js';

interface ArtifactListProps {
	items: ArtifactItem[];
	focusedIndex: number;
	selectedIndices: ReadonlySet<number>;
	viewStart: number;
	viewEnd: number;
	height: number;
}

interface RowProps {
	item: ArtifactItem;
	isSelected: boolean;
	isFocused: boolean;
	isDeleted: boolean;
}

const STATUS_COLOR = {
	selected: 'green',
	idle: 'gray',
	deleted: 'gray',
	focused: 'black',
	default: 'white',
};

const CANDIDATE_BADGES: Record<CandidateType, {label: string; color: string}> =
	{
		artifact: {label: 'ART', color: 'blue'},
		asset: {label: 'AST', color: 'yellow'},
		node_modules: {label: 'NODE', color: 'magenta'},
		'pm-cache': {label: 'PM', color: 'red'},
	};

const statusToken = (item: ArtifactItem, isSelected: boolean) => {
	if (item.status === 'deleting') return '...';
	if (item.status === 'deleted') return 'OK';
	if (item.status === 'error') return '!!';
	if (item.status === 'dry-run') return '~';
	return isSelected ? '[x]' : '[ ]';
};

function Row({item, isSelected, isFocused, isDeleted}: RowProps) {
	const status = statusToken(item, isSelected);
	const markerColor =
		item.status === 'deleted'
			? STATUS_COLOR.deleted
			: isSelected
				? STATUS_COLOR.selected
				: STATUS_COLOR.idle;

	const textColor = isDeleted
		? STATUS_COLOR.deleted
		: isFocused
			? STATUS_COLOR.focused
			: STATUS_COLOR.default;
	const backgroundColor = isFocused ? (isDeleted ? 'gray' : 'cyan') : undefined;
	const ageLabel = timeAgo(item.mtime).replace(' ago', '');
	const badge = CANDIDATE_BADGES[item.candidateType];
	const nodeType = item.isDirectory ? '[D]' : '[F]';

	return (
		<box width="100%" height={1} backgroundColor={backgroundColor}>
			<box width={4} justifyContent="center" paddingRight={1}>
				<text>
					<span fg={markerColor}>{status}</span>
				</text>
			</box>

			<box width={11} justifyContent="flex-end" paddingRight={1}>
				<text>
					<span fg={textColor}>{human(item.size)}</span>
				</text>
			</box>

			<box width={8} justifyContent="flex-end" paddingRight={1}>
				<text>
					<span fg={textColor}>{ageLabel}</span>
				</text>
			</box>

			<box flexGrow={1} overflow="hidden">
				<text>
					<span fg={textColor}>
						<span fg={badge.color}>[{badge.label}]</span> {nodeType}{' '}
						{item.relPath}
					</span>
				</text>
			</box>
		</box>
	);
}

export function ArtifactList({
	items,
	focusedIndex,
	selectedIndices,
	viewStart,
	viewEnd,
	height,
}: ArtifactListProps) {
	return (
		<box flexDirection="column" height={height} width="100%">
			<box width="100%">
				<box width={4} paddingRight={1} />
				<box width={11} justifyContent="flex-end" paddingRight={1}>
					<text>
						<span fg="gray">
							<strong>Size</strong>
						</span>
					</text>
				</box>
				<box width={8} justifyContent="flex-end" paddingRight={1}>
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
					<box
						height="100%"
						width="100%"
						justifyContent="center"
						alignItems="center"
					>
						<text>
							<span fg="gray">No artifacts found.</span>
						</text>
					</box>
				) : (
					items.slice(viewStart, viewEnd).map((item, offset) => {
						const absoluteIndex = viewStart + offset;
						return (
							<Row
								key={item.path}
								item={item}
								isSelected={selectedIndices.has(absoluteIndex)}
								isFocused={absoluteIndex === focusedIndex}
								isDeleted={item.status === 'deleted'}
							/>
						);
					})
				)}
			</box>
		</box>
	);
}
