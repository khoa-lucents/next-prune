export type SortMode = 'size' | 'age' | 'path';

export type ArtifactStatus = 'deleting' | 'deleted' | 'error' | 'dry-run';

export type CandidateType = 'artifact' | 'asset' | 'node_modules' | 'pm-cache';

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

export interface ShortcutHint {
	key: string;
	label: string;
}
