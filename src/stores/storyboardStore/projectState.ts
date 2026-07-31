import {
  STORYBOARD_SCHEMA_VERSION,
  cloneStoryboardProjectState,
  type StoryboardProjectState,
} from '../../services/storyboard/contracts';

export function createEmptyStoryboardStoreProjectState(): StoryboardProjectState {
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

export function cloneStoryboardStoreProjectState(
  state: StoryboardProjectState,
): StoryboardProjectState {
  return cloneStoryboardProjectState(state);
}

export function selectStoryboardProjectState(
  state: StoryboardProjectState,
): StoryboardProjectState {
  return {
    schemaVersion: state.schemaVersion,
    plans: state.plans,
    scenes: state.scenes,
    generationBriefs: state.generationBriefs,
    candidates: state.candidates,
    evidenceRefs: state.evidenceRefs,
    coverageBySceneId: state.coverageBySceneId,
    variantSets: state.variantSets,
    variantOptions: state.variantOptions,
    decisions: state.decisions,
    templates: state.templates,
  };
}
