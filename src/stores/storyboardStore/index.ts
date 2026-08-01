import { create } from 'zustand';
import {
  reconcileStoryboardGenerationRecord,
  setStoryboardCandidateState,
  type AdaptGenerationRecordInput,
} from '../../services/storyboard/candidates';
import {
  createStoryboardGenerationBriefRevision,
  type CreateStoryboardGenerationBriefRevisionInput,
} from '../../services/storyboard/generation';
import type {
  StoryboardCandidate,
  StoryboardCandidateState,
  StoryboardDecision,
  StoryboardGenerationBrief,
  StoryboardProjectState,
  TimelineVariantOption,
  TimelineVariantSet,
} from '../../services/storyboard/contracts';
import {
  markStoryboardDecisionStale,
  resolveStoryboardDecisionRecord,
  type StoryboardDecisionSelection,
} from '../../services/storyboard/decisions';
import {
  cloneStoryboardStoreProjectState,
  createEmptyStoryboardStoreProjectState,
  selectStoryboardProjectState,
} from './projectState';
import { projectStoryboardTimelineClips } from './timelineProjection';
import { withExclusiveHistorySnapshotMutationLease } from '../timeline/exclusiveMutationLease';

export interface StoryboardStoreActions {
  createGenerationBriefRevision(
    input: CreateStoryboardGenerationBriefRevisionInput,
  ): StoryboardGenerationBrief;
  hydrateProjectState(state: StoryboardProjectState): void;
  markDecisionStale(decisionId: string): void;
  putDecision(decision: StoryboardDecision): void;
  putVariantOption(option: TimelineVariantOption): void;
  putVariantSet(variantSet: TimelineVariantSet): void;
  reconcileGenerationRecord(input: AdaptGenerationRecordInput): StoryboardCandidate[];
  resolveDecision(selection: StoryboardDecisionSelection): void;
  resetProjectState(): void;
  setCandidateState(candidateId: string, state: StoryboardCandidateState): void;
}

export type StoryboardStore = StoryboardProjectState & StoryboardStoreActions;

export const useStoryboardStore = create<StoryboardStore>(withExclusiveHistorySnapshotMutationLease((set) => ({
  ...createEmptyStoryboardStoreProjectState(),

  createGenerationBriefRevision(input) {
    let created: StoryboardGenerationBrief | undefined;
    set((current) => {
      const result = createStoryboardGenerationBriefRevision(
        selectStoryboardProjectState(current),
        input,
      );
      created = result.brief;
      return result.state;
    });
    if (!created) throw new Error('Generation brief revision was not created.');
    return created;
  },

  hydrateProjectState(state) {
    set(cloneStoryboardStoreProjectState(state));
  },

  markDecisionStale(decisionId) {
    set((current) => {
      const decision = current.decisions[decisionId];
      if (!decision) return current;
      return {
        decisions: {
          ...current.decisions,
          [decisionId]: markStoryboardDecisionStale(decision),
        },
      };
    });
  },

  putDecision(decision) {
    set((current) => ({
      decisions: {
        ...current.decisions,
        [decision.id]: structuredClone(decision),
      },
    }));
  },

  putVariantOption(option) {
    set((current) => ({
      variantOptions: {
        ...current.variantOptions,
        [option.id]: structuredClone(option),
      },
    }));
  },

  putVariantSet(variantSet) {
    set((current) => ({
      variantSets: {
        ...current.variantSets,
        [variantSet.id]: structuredClone(variantSet),
      },
    }));
  },

  reconcileGenerationRecord(input) {
    let reconciled: StoryboardCandidate[] = [];
    set((current) => {
      const result = reconcileStoryboardGenerationRecord(
        selectStoryboardProjectState(current),
        input,
      );
      reconciled = result.candidates;
      return result.state;
    });
    return reconciled;
  },

  resolveDecision(selection) {
    set((current) => {
      const decision = current.decisions[selection.decisionId];
      if (!decision) throw new Error(`Decision not found: ${selection.decisionId}`);
      return {
        decisions: {
          ...current.decisions,
          [decision.id]: resolveStoryboardDecisionRecord(decision, selection),
        },
      };
    });
  },

  resetProjectState() {
    set(createEmptyStoryboardStoreProjectState());
  },

  setCandidateState(candidateId, candidateState) {
    set((current) => setStoryboardCandidateState(
      selectStoryboardProjectState(current),
      candidateId,
      candidateState,
    ));
  },
})));

export function getStoryboardProjectSnapshot(): StoryboardProjectState {
  return cloneStoryboardStoreProjectState(
    selectStoryboardProjectState(useStoryboardStore.getState()),
  );
}

export function hydrateStoryboardProjectState(state: StoryboardProjectState): void {
  useStoryboardStore.getState().hydrateProjectState(state);
}

export function resetStoryboardProjectState(): void {
  useStoryboardStore.getState().resetProjectState();
}

export function reconcileStoryboardTimelineClips(
  clips: readonly import('../../types/timeline').TimelineClip[],
): StoryboardProjectState {
  const current = getStoryboardProjectSnapshot();
  const projected = projectStoryboardTimelineClips(current, clips);
  if (
    JSON.stringify(current.plans) !== JSON.stringify(projected.plans)
    || JSON.stringify(current.scenes) !== JSON.stringify(projected.scenes)
  ) {
    hydrateStoryboardProjectState(projected);
  }
  return projected;
}

export * from './projectState';
export * from './timelineProjection';
export {
  deriveStoryboardSceneStatusFromCandidates,
  selectStoryboardCandidate,
  selectStoryboardCandidateByProvenance,
  selectStoryboardCandidatesForGenerationRecord,
  selectStoryboardCandidatesForScene,
} from '../../services/storyboard/candidates';
export {
  selectLatestStoryboardGenerationBrief,
  selectStoryboardGenerationBriefRevisions,
} from '../../services/storyboard/generation';
