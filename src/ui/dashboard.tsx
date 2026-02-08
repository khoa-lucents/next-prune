/** @jsxImportSource @opentui/react */

import {human} from '../core/format.js';

interface DashboardCardProps {
	label: string;
	value: string;
	color: string;
}

interface DashboardProps {
	foundCount: number;
	totalSize: number;
	selectedCount: number;
	selectedSize: number;
	nodeModulesCount: number;
	pmCachesCount: number;
	cleanupScopeLabel: string;
	loading: boolean;
	cwd: string;
	terminalWidth: number;
}

function DashboardCard({label, value, color}: DashboardCardProps) {
	return (
		<box flexDirection="column" marginRight={3}>
			<text>
				<span fg="gray">{label}</span>
			</text>
			<text>
				<span fg={color}>
					<strong>{value}</strong>
				</span>
			</text>
		</box>
	);
}

export function Dashboard({
	foundCount,
	totalSize,
	selectedCount,
	selectedSize,
	nodeModulesCount,
	pmCachesCount,
	cleanupScopeLabel,
	loading,
	cwd,
	terminalWidth,
}: DashboardProps) {
	const compact = terminalWidth < 100;
	const riskyCount = nodeModulesCount + pmCachesCount;

	return (
		<box
			border
			borderStyle="rounded"
			borderColor="blue"
			paddingLeft={1}
			paddingRight={1}
			flexDirection={compact ? 'column' : 'row'}
			justifyContent="space-between"
			width="100%"
		>
			<box flexDirection="row" marginBottom={compact ? 1 : 0}>
				<DashboardCard
					label="Found"
					value={loading ? 'Scanning...' : `${foundCount} items`}
					color={loading ? 'yellow' : 'white'}
				/>
				<DashboardCard
					label="Total Size"
					value={loading ? '...' : human(totalSize)}
					color="magenta"
				/>
				<DashboardCard
					label="Reclaimable"
					value={human(selectedSize)}
					color={selectedCount > 0 ? 'green' : 'gray'}
				/>
			</box>

			<box
				flexDirection="column"
				alignItems={compact ? 'flex-start' : 'flex-end'}
			>
				<text>
					<span fg="gray">Path</span>
				</text>
				<text>
					<span fg="blue">{cwd}</span>
				</text>
				<text>
					<span fg="gray">Scope: {cleanupScopeLabel}</span>
				</text>
				<text>
					<span fg={riskyCount > 0 ? 'yellow' : 'gray'}>
						Risky: {riskyCount}
					</span>
				</text>
			</box>
		</box>
	);
}
