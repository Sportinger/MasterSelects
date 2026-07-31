import {
  assertTimelineVariantOption,
  assertTimelineVariantSet,
  type TimelineVariantOption,
  type TimelineVariantSet,
} from '../../services/storyboard/contracts';
import type {
  StoryboardVariantWorkspaceState,
  VariantRangeSnapshot,
} from '../../services/storyboard/variants/types';

export type StoryboardVariantStateAction =
  | { type: 'put-set'; variantSet: TimelineVariantSet }
  | { type: 'put-option'; option: TimelineVariantOption }
  | { type: 'attach-snapshot'; variantSetId: string; snapshot: VariantRangeSnapshot }
  | { type: 'mark-stale'; variantSetId: string };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function createEmptyStoryboardVariantState(): StoryboardVariantWorkspaceState {
  return {
    schemaVersion: 1,
    variantSets: {},
    variantOptions: {},
    rangeSnapshots: {},
  };
}

export function reduceStoryboardVariantState(
  state: StoryboardVariantWorkspaceState,
  action: StoryboardVariantStateAction,
): StoryboardVariantWorkspaceState {
  if (state.schemaVersion !== 1) throw new Error('Unsupported variant workspace schemaVersion.');
  if (action.type === 'put-set') {
    assertTimelineVariantSet(action.variantSet);
    return {
      ...state,
      variantSets: {
        ...state.variantSets,
        [action.variantSet.id]: clone(action.variantSet),
      },
    };
  }
  if (action.type === 'put-option') {
    assertTimelineVariantOption(action.option);
    const variantSet = state.variantSets[action.option.variantSetId];
    if (!variantSet) {
      throw new Error(`Variant option references missing set ${action.option.variantSetId}.`);
    }
    const optionIds = [...new Set([...variantSet.optionIds, action.option.id])];
    return {
      ...state,
      variantSets: {
        ...state.variantSets,
        [variantSet.id]: {
          ...variantSet,
          optionIds,
        },
      },
      variantOptions: {
        ...state.variantOptions,
        [action.option.id]: clone(action.option),
      },
    };
  }
  if (action.type === 'attach-snapshot') {
    if (!state.variantSets[action.variantSetId]) {
      throw new Error(`Snapshot references missing set ${action.variantSetId}.`);
    }
    return {
      ...state,
      rangeSnapshots: {
        ...state.rangeSnapshots,
        [action.variantSetId]: clone(action.snapshot),
      },
    };
  }
  const variantSet = state.variantSets[action.variantSetId];
  if (!variantSet) throw new Error(`Missing variant set ${action.variantSetId}.`);
  return {
    ...state,
    variantSets: {
      ...state.variantSets,
      [variantSet.id]: {
        ...variantSet,
        status: 'stale',
      },
    },
  };
}
