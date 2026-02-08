import type {UiAction} from './events.js';
import type {
	ArtifactItem,
	FocusZone,
	ScanPhase,
	SortMode,
	StatusNotice,
} from '../types.js';
import {SORT_MODES, clampIndex} from '../view-model/candidates.js';

export interface UiState {
	scanPhase: ScanPhase;
	items: ArtifactItem[];
	selectedPaths: Set<string>;
	cursorIndex: number;
	sortBy: SortMode;
	query: string;
	focusZone: FocusZone;
	helpOpen: boolean;
	confirmOpen: boolean;
	errorMessage: string | null;
	status: StatusNotice | null;
}

export const createInitialUiState = ({
	startLoading,
}: {
	startLoading: boolean;
}): UiState => ({
	scanPhase: startLoading ? 'loading' : 'ready',
	items: [],
	selectedPaths: new Set<string>(),
	cursorIndex: 0,
	sortBy: 'size',
	query: '',
	focusZone: 'list',
	helpOpen: false,
	confirmOpen: false,
	errorMessage: null,
	status: null,
});

const filterSelectablePaths = (
	items: readonly ArtifactItem[],
	selectedPaths: Iterable<string>,
): Set<string> => {
	const available = new Set(
		items.filter(item => item.status !== 'deleted').map(item => item.path),
	);
	return new Set(
		[...selectedPaths].filter(itemPath => available.has(itemPath)),
	);
};

export const uiReducer = (state: UiState, action: UiAction): UiState => {
	switch (action.type) {
		case 'SCAN_START':
			return {
				...state,
				scanPhase: 'loading',
				errorMessage: null,
				confirmOpen: false,
				helpOpen: false,
				focusZone: 'list',
				status: null,
			};

		case 'SCAN_SUCCESS':
			return {
				...state,
				scanPhase: 'ready',
				items: action.items,
				selectedPaths: filterSelectablePaths(
					action.items,
					action.selectedPaths,
				),
				cursorIndex: 0,
				errorMessage: null,
				confirmOpen: false,
				helpOpen: false,
				focusZone: 'list',
			};

		case 'SCAN_FAILURE':
			return {
				...state,
				scanPhase: 'error',
				errorMessage: action.message,
				confirmOpen: false,
				helpOpen: false,
				focusZone: 'list',
				status: {
					kind: 'error',
					message: action.message,
				},
			};

		case 'MOVE_CURSOR':
			return {
				...state,
				cursorIndex: clampIndex(state.cursorIndex + action.delta, action.total),
			};

		case 'SET_CURSOR':
			return {
				...state,
				cursorIndex: clampIndex(action.index, action.total),
			};

		case 'ENSURE_CURSOR':
			return {
				...state,
				cursorIndex: clampIndex(state.cursorIndex, action.total),
			};

		case 'TOGGLE_SELECTION': {
			const selectedPaths = new Set(state.selectedPaths);
			if (selectedPaths.has(action.path)) {
				selectedPaths.delete(action.path);
			} else {
				selectedPaths.add(action.path);
			}
			return {
				...state,
				selectedPaths: filterSelectablePaths(state.items, selectedPaths),
			};
		}

		case 'SELECT_PATHS': {
			const selectedPaths = new Set(state.selectedPaths);
			for (const path of action.paths) {
				selectedPaths.add(path);
			}
			return {
				...state,
				selectedPaths: filterSelectablePaths(state.items, selectedPaths),
			};
		}

		case 'CLEAR_SELECTION':
			return {
				...state,
				selectedPaths: new Set<string>(),
			};

		case 'SET_SORT':
			return {
				...state,
				sortBy: action.sortBy,
			};

		case 'CYCLE_SORT': {
			const nextIndex =
				(SORT_MODES.indexOf(state.sortBy) + 1) % SORT_MODES.length;
			return {
				...state,
				sortBy: SORT_MODES[nextIndex],
			};
		}

		case 'SET_QUERY':
			return {
				...state,
				query: action.query,
				cursorIndex: 0,
			};

		case 'SET_FOCUS_ZONE':
			return {
				...state,
				focusZone: action.zone,
			};

		case 'OPEN_CONFIRM':
			return {
				...state,
				confirmOpen: true,
				helpOpen: false,
				focusZone: 'confirm',
			};

		case 'CLOSE_CONFIRM':
			return {
				...state,
				confirmOpen: false,
				focusZone: 'list',
			};

		case 'TOGGLE_HELP':
			if (state.helpOpen) {
				return {
					...state,
					helpOpen: false,
					focusZone: state.confirmOpen ? 'confirm' : 'list',
				};
			}
			return {
				...state,
				helpOpen: true,
				confirmOpen: false,
				focusZone: 'help',
			};

		case 'CLOSE_HELP':
			return {
				...state,
				helpOpen: false,
				focusZone: state.confirmOpen ? 'confirm' : 'list',
			};

		case 'SET_STATUS':
			return {
				...state,
				status: action.status,
			};

		case 'MARK_ITEMS_STATUS': {
			const targetPaths = new Set(action.paths);
			const nextItems = state.items.map(item => {
				if (!targetPaths.has(item.path)) return item;
				return {
					...item,
					status: action.status,
				};
			});
			const nextSelectedPaths =
				action.status === 'deleted'
					? new Set(
							[...state.selectedPaths].filter(path => !targetPaths.has(path)),
						)
					: state.selectedPaths;
			return {
				...state,
				items: nextItems,
				selectedPaths: nextSelectedPaths,
			};
		}

		case 'APPLY_DELETE_RESULTS': {
			const succeeded = new Set(action.succeeded);
			const failed = new Set(action.failed);

			const nextItems = state.items.map(item => {
				if (succeeded.has(item.path)) {
					return {
						...item,
						status: 'deleted' as const,
						size: 0,
					};
				}
				if (failed.has(item.path)) {
					return {
						...item,
						status: 'error' as const,
					};
				}
				return item;
			});

			const nextSelectedPaths = new Set(
				[...state.selectedPaths].filter(path => !succeeded.has(path)),
			);

			return {
				...state,
				items: nextItems,
				selectedPaths: nextSelectedPaths,
			};
		}
	}
};
