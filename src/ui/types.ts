export type SortMode = 'size' | 'age' | 'path';
export type FocusZone = 'list' | 'search' | 'confirm' | 'help';
export type ScanPhase = 'idle' | 'loading' | 'ready' | 'error';
export type StatusKind = 'error' | 'success' | 'info';

export type ArtifactStatus = 'deleting' | 'deleted' | 'error' | 'dry-run';
export type CandidateType = 'artifact' | 'asset' | 'node_modules' | 'pm-cache';

export interface StatusNotice {
	kind: StatusKind;
	message: string;
}

export interface ArtifactItem {
	path: string;
	relPath: string;
	size: number;
	mtime: Date;
	isDirectory: boolean;
	type?: 'asset' | 'artifact';
	candidateType: CandidateType;
	status?: ArtifactStatus;
}

export interface SelectedTypeCounts {
	artifact: number;
	asset: number;
	nodeModules: number;
	pmCaches: number;
}

export interface Metrics {
	foundCount: number;
	totalSize: number;
	selectedCount: number;
	selectedSize: number;
	nodeModulesCount: number;
	pmCachesCount: number;
}
