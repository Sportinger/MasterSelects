import { useMediaStore } from '../../../stores/mediaStore';
import type { Composition } from '../../../stores/mediaStore/types';
import { useStoryboardStore } from '../../../stores/storyboardStore';
import type {
  TimelineVariantOption,
  TimelineVariantSet,
} from '../contracts';
import {
  materializeTimelineVariantOption,
  materializeTimelineVariantSet,
  type MaterializedTimelineVariantOption,
  type MaterializeTimelineVariantOptionInput,
  type MaterializeTimelineVariantSetInput,
} from './materialization';
import { recordStoryboardTelemetry } from '../telemetry';

export interface VariantMaterializationRuntimePorts {
  listCompositions(): readonly Composition[];
  installCompositions(compositions: readonly Composition[]): void;
  putOption(option: TimelineVariantOption): void;
  putSet(variantSet: TimelineVariantSet): void;
  openComposition?(compositionId: string, playFromTime: number): void;
}

const defaultPorts: VariantMaterializationRuntimePorts = {
  listCompositions: () => useMediaStore.getState().compositions,
  installCompositions: (compositions) => {
    useMediaStore.setState((state) => ({
      compositions: [...state.compositions, ...compositions],
    }));
  },
  putOption: (option) => useStoryboardStore.getState().putVariantOption(option),
  putSet: (variantSet) => useStoryboardStore.getState().putVariantSet(variantSet),
  openComposition: (compositionId, playFromTime) => {
    void useMediaStore.getState().openCompositionTab(compositionId, {
      playFromTime,
      skipAnimation: true,
    });
  },
};

function assertFreshCompositionIds(
  existing: readonly Composition[],
  materialized: readonly MaterializedTimelineVariantOption[],
): void {
  const ids = new Set(existing.map((composition) => composition.id));
  for (const result of materialized) {
    for (const composition of result.graph.compositions) {
      if (ids.has(composition.id)) {
        throw new Error(`Variant materialization produced duplicate composition id ${composition.id}.`);
      }
      ids.add(composition.id);
    }
  }
}

function reviewSet(
  variantSet: TimelineVariantSet,
  results: readonly MaterializedTimelineVariantOption[],
): TimelineVariantSet {
  return {
    ...variantSet,
    status: 'review',
    optionIds: results.map((result) => result.option.id),
  };
}

export function installMaterializedTimelineVariantOption(
  input: Omit<MaterializeTimelineVariantOptionInput, 'compositions'> & {
    compositions?: readonly Composition[];
  },
  ports: VariantMaterializationRuntimePorts = defaultPorts,
): MaterializedTimelineVariantOption {
  const compositions = input.compositions ?? ports.listCompositions();
  const result = materializeTimelineVariantOption({ ...input, compositions });
  assertFreshCompositionIds(compositions, [result]);
  ports.installCompositions(result.graph.compositions);
  ports.putOption(result.option);
  ports.putSet({
    ...input.variantSet,
    status: 'review',
    optionIds: [...new Set([...input.variantSet.optionIds, result.option.id])],
  });
  ports.openComposition?.(
    result.graph.rootCompositionId,
    input.variantSet.scope.startTime,
  );
  recordStoryboardTelemetry('variant.materialized', {
    optionCount: 1,
    status: result.option.state === 'building' ? 'partial' : 'full',
  });
  return result;
}

export function installMaterializedTimelineVariantSet(
  input: Omit<MaterializeTimelineVariantSetInput, 'compositions'> & {
    compositions?: readonly Composition[];
  },
  ports: VariantMaterializationRuntimePorts = defaultPorts,
): MaterializedTimelineVariantOption[] {
  const compositions = input.compositions ?? ports.listCompositions();
  const results = materializeTimelineVariantSet({ ...input, compositions });
  assertFreshCompositionIds(compositions, results);
  ports.installCompositions(results.flatMap((result) => result.graph.compositions));
  for (const result of results) ports.putOption(result.option);
  ports.putSet(reviewSet(input.variantSet, results));
  const firstPlayable = results.find((result) => result.playable);
  if (firstPlayable) {
    ports.openComposition?.(
      firstPlayable.graph.rootCompositionId,
      input.variantSet.scope.startTime,
    );
  }
  recordStoryboardTelemetry('variant.materialized', {
    failedCount: results.filter((result) => !result.playable).length,
    optionCount: results.length,
    status: results.some((result) => result.option.state === 'building')
      ? 'partial'
      : 'full',
  });
  return results;
}
