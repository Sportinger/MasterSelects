import {
  cancelHistoryBatch,
  endBatch,
  startBatch,
} from '../../../stores/historyStore';
import { useMediaStore } from '../../../stores/mediaStore';
import type { Composition } from '../../../stores/mediaStore/types';
import {
  getStoryboardProjectSnapshot,
  hydrateStoryboardProjectState,
  useStoryboardStore,
} from '../../../stores/storyboardStore';
import { useTimelineStore } from '../../../stores/timeline';
import type { StoryboardProjectState } from '../contracts';
import { recordStoryboardTelemetry } from '../telemetry';
import {
  replaceTimelineRangeWithVariant,
  StaleTimelineVariantError,
  type ReplaceTimelineRangeWithVariantInput,
  type ReplaceTimelineRangeWithVariantResult,
} from './rangeCommit';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .toSorted(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export interface TimelineVariantCommitVerification {
  ok: boolean;
  message?: string;
}

export interface TimelineVariantCommitRuntimePorts {
  listCompositions(): readonly Composition[];
  getStoryboardState(): StoryboardProjectState;
  applyBaseComposition(composition: Composition): Promise<void> | void;
  applyStoryboardState(state: StoryboardProjectState): void;
  markVariantSetStale(variantSet: StaleTimelineVariantError['variantSet']): void;
  startHistoryBatch(label: string): { opened: boolean };
  endHistoryBatch(): void;
  cancelHistoryBatch(): void;
  verifyComplete?(
    result: ReplaceTimelineRangeWithVariantResult,
  ): Promise<TimelineVariantCommitVerification>;
}

const defaultPorts: TimelineVariantCommitRuntimePorts = {
  listCompositions: () => useMediaStore.getState().compositions,
  getStoryboardState: getStoryboardProjectSnapshot,
  applyBaseComposition: async (composition) => {
    if (useMediaStore.getState().activeCompositionId === composition.id) {
      await useTimelineStore.getState().loadState(composition.timelineData);
    }
    useMediaStore.setState((state) => ({
      compositions: state.compositions.map((entry) => (
        entry.id === composition.id ? composition : entry
      )),
    }));
  },
  applyStoryboardState: hydrateStoryboardProjectState,
  markVariantSetStale: (variantSet) => (
    useStoryboardStore.getState().putVariantSet(variantSet)
  ),
  startHistoryBatch: (label) => startBatch(label),
  endHistoryBatch: endBatch,
  cancelHistoryBatch,
  verifyComplete: async (result) => {
    const committedBase = useMediaStore.getState().compositions.find(
      (composition) => composition.id === result.baseComposition.id,
    );
    if (
      !committedBase
      || canonicalJson(committedBase.timelineData)
        !== canonicalJson(result.baseComposition.timelineData)
    ) {
      return {
        ok: false,
        message: 'Committed base composition does not match the verified variant result.',
      };
    }
    if (
      useMediaStore.getState().activeCompositionId === result.baseComposition.id
      && canonicalJson(useTimelineStore.getState().getSerializableState())
        !== canonicalJson(result.baseComposition.timelineData)
    ) {
      return {
        ok: false,
        message: 'Active timeline does not match the committed variant result.',
      };
    }
    if (
      result.storyboardState
      && canonicalJson(getStoryboardProjectSnapshot())
        !== canonicalJson(result.storyboardState)
    ) {
      return {
        ok: false,
        message: 'Storyboard state does not match the committed variant result.',
      };
    }
    return { ok: true };
  },
};

export async function commitTimelineVariantOption(
  input: Omit<
    ReplaceTimelineRangeWithVariantInput,
    'compositions' | 'storyboardState'
  > & {
    compositions?: readonly Composition[];
    storyboardState?: StoryboardProjectState;
  },
  ports: TimelineVariantCommitRuntimePorts = defaultPorts,
): Promise<ReplaceTimelineRangeWithVariantResult> {
  const compositions = input.compositions ?? ports.listCompositions();
  const storyboardState = input.storyboardState ?? ports.getStoryboardState();
  let result: ReplaceTimelineRangeWithVariantResult;
  try {
    result = await replaceTimelineRangeWithVariant({
      ...input,
      compositions,
      storyboardState,
    });
  } catch (error) {
    if (error instanceof StaleTimelineVariantError) {
      ports.markVariantSetStale(error.variantSet);
      recordStoryboardTelemetry('variant.stale', { status: 'stale' });
    }
    throw error;
  }

  const batch = ports.startHistoryBatch(`Commit storyboard option: ${result.option.title}`);
  let completionVerificationFailed = false;
  try {
    await ports.applyBaseComposition(result.baseComposition);
    if (result.storyboardState) ports.applyStoryboardState(result.storyboardState);
    const verification = await ports.verifyComplete?.(result);
    if (verification && !verification.ok) {
      completionVerificationFailed = true;
      throw new Error(
        verification.message ?? 'Kernel completion verification rejected the variant commit.',
      );
    }
    if (batch.opened) ports.endHistoryBatch();
    recordStoryboardTelemetry('variant.committed', {
      boundaryPolicy: input.boundaryPolicy,
      count: result.insertedClipIds.length,
      warningCount: result.warnings.length,
    });
    return result;
  } catch (error) {
    if (batch.opened) ports.cancelHistoryBatch();
    recordStoryboardTelemetry('variant.commit_failed', {
      reason: completionVerificationFailed ? 'verification' : 'runtime',
    });
    throw error;
  }
}
