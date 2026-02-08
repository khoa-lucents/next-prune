export type ScanItemType = 'artifact' | 'asset';
export type CleanupScope = 'project' | 'workspace';
export type CleanupType =
	| 'artifact'
	| 'asset'
	| 'pm-cache'
	| 'workspace-node-modules';
export type MonorepoMode = 'auto' | 'on' | 'off';
export type WorkspaceDiscoveryMode =
	| 'manifest-fallback'
	| 'manifest-only'
	| 'heuristic-only';
export type WorkspaceDiscoverySource = 'manifest' | 'heuristic' | 'none';

export interface ArtifactStats {
	size: number;
	mtime: Date;
	fileCount: number;
	isDirectory: boolean;
	error?: string;
}

export interface ScanItem extends ArtifactStats {
	path: string;
	type?: ScanItemType;
	cleanupScope?: CleanupScope;
	cleanupType?: CleanupType;
}

export interface PruneConfig {
	alwaysDelete: string[];
	neverDelete: string[];
	checkUnusedAssets: boolean;
	monorepoMode?: MonorepoMode;
	workspaceDiscoveryMode?: WorkspaceDiscoveryMode;
	cleanupScopes?: CleanupScope[];
	includeNodeModules?: boolean;
	includeProjectLocalPmCaches?: boolean;
	maxScanDepth?: number;
}

export interface ScannerOptions {
	skipDirs?: Iterable<string>;
	monorepoMode?: MonorepoMode;
	workspaceDiscoveryMode?: WorkspaceDiscoveryMode;
	cleanupScopes?: Iterable<CleanupScope>;
	includeNodeModules?: boolean;
	includeProjectLocalPmCaches?: boolean;
	maxDepth?: number;
}

export type RuntimeScanOptions = ScannerOptions & {
	cleanupScope?: string;
};

export interface AssetScannerOptions {
	sourceDirectories?: string[];
	skipDirs?: Iterable<string>;
}

export interface DeleteSuccessResult {
	path: string;
	ok: true;
	size: number;
}

export interface DeleteFailureResult {
	path: string;
	ok: false;
	size: number;
	error: unknown;
}

export type DeleteResult = DeleteSuccessResult | DeleteFailureResult;

export interface DeleteSummary {
	results: DeleteResult[];
	deletedCount: number;
	failureCount: number;
	reclaimedBytes: number;
}

export interface WorkspaceDiscoveryResult {
	rootDirectory: string;
	workspaceDirectories: string[];
	source: WorkspaceDiscoverySource;
	manifestPatterns: string[];
	hasManifest: boolean;
}
