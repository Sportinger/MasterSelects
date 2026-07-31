import {
  STORYBOARD_SCHEMA_VERSION,
  StoryboardContractError,
  assertStoryboardProjectState,
  cloneStoryboardProjectState,
  isPlainRecord,
  type StoryboardProjectState,
} from '../../storyboard/contracts';

export const STORYBOARD_PROJECT_FIELD = 'storyboard' as const;

export type StoryboardProjectMigrationSource = 'missing' | 'v1';

export interface DecodedStoryboardProjectState {
  source: StoryboardProjectMigrationSource;
  state: StoryboardProjectState;
}

export function createEmptyStoryboardProjectState(): StoryboardProjectState {
  return {
    schemaVersion: STORYBOARD_SCHEMA_VERSION,
    plans: {},
    scenes: {},
    generationBriefs: {},
    candidates: {},
    evidenceRefs: {},
    coverageBySceneId: {},
    variantSets: {},
    variantOptions: {},
    decisions: {},
    templates: {},
  };
}

/**
 * Missing data is the only implicit migration. An explicitly present but
 * malformed or newer payload fails closed so opening a project cannot silently
 * erase storyboard content.
 */
export function decodeStoryboardProjectState(value: unknown): DecodedStoryboardProjectState {
  if (value === undefined) {
    return {
      source: 'missing',
      state: createEmptyStoryboardProjectState(),
    };
  }
  assertStoryboardProjectState(value, STORYBOARD_PROJECT_FIELD);
  return {
    source: 'v1',
    state: cloneStoryboardProjectState(value),
  };
}

export function encodeStoryboardProjectState(
  state: StoryboardProjectState,
): StoryboardProjectState {
  return cloneStoryboardProjectState(state);
}

export function readStoryboardProjectState(project: unknown): DecodedStoryboardProjectState {
  if (!isPlainRecord(project)) {
    throw new StoryboardContractError('expected a project object', 'project');
  }
  return decodeStoryboardProjectState(project[STORYBOARD_PROJECT_FIELD]);
}

export function migrateProjectWithStoryboard<T extends Record<string, unknown>>(
  project: T,
): T & { storyboard: StoryboardProjectState } {
  if (!isPlainRecord(project)) {
    throw new StoryboardContractError('expected a project object', 'project');
  }
  const decoded = decodeStoryboardProjectState(project[STORYBOARD_PROJECT_FIELD]);
  return {
    ...project,
    storyboard: decoded.state,
  };
}
