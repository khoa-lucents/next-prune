import type {
	ArtifactItem,
	ArtifactStatus,
	FocusZone,
	StatusNotice,
	SortMode,
} from '../types.js';

export type UiAction =
	| {
			type: 'SCAN_START';
	  }
	| {
			type: 'SCAN_SUCCESS';
			items: ArtifactItem[];
			selectedPaths: string[];
	  }
	| {
			type: 'SCAN_FAILURE';
			message: string;
	  }
	| {
			type: 'MOVE_CURSOR';
			delta: number;
			total: number;
	  }
	| {
			type: 'SET_CURSOR';
			index: number;
			total: number;
	  }
	| {
			type: 'ENSURE_CURSOR';
			total: number;
	  }
	| {
			type: 'TOGGLE_SELECTION';
			path: string;
	  }
	| {
			type: 'SELECT_PATHS';
			paths: string[];
	  }
	| {
			type: 'CLEAR_SELECTION';
	  }
	| {
			type: 'SET_SORT';
			sortBy: SortMode;
	  }
	| {
			type: 'CYCLE_SORT';
	  }
	| {
			type: 'SET_QUERY';
			query: string;
	  }
	| {
			type: 'SET_FOCUS_ZONE';
			zone: FocusZone;
	  }
	| {
			type: 'OPEN_CONFIRM';
	  }
	| {
			type: 'CLOSE_CONFIRM';
	  }
	| {
			type: 'TOGGLE_HELP';
	  }
	| {
			type: 'CLOSE_HELP';
	  }
	| {
			type: 'SET_STATUS';
			status: StatusNotice | null;
	  }
	| {
			type: 'MARK_ITEMS_STATUS';
			paths: string[];
			status: ArtifactStatus;
	  }
	| {
			type: 'APPLY_DELETE_RESULTS';
			succeeded: string[];
			failed: string[];
	  };
