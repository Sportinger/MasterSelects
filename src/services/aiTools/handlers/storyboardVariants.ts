import { useMediaStore } from '../../../stores/mediaStore';
import { useStoryboardStore } from '../../../stores/storyboardStore';
import { useTimelineStore } from '../../../stores/timeline';
import {
  assertTimelineVariantOption,
  type TimelineVariantOption,
  type TimelineVariantSet,
} from '../../storyboard/contracts';
import {
  archiveTimelineVariantSet,
  captureVariantRangeSnapshot,
  commitTimelineVariantOption,
  createVariantTimelineSourceFromComposition,
  fingerprintVariantRangeSnapshot,
  installMaterializedTimelineVariantOption,
} from '../../storyboard/variants';
import type { ToolResult } from '../types';

const DEFAULT_BOUNDARY_PADDING_SECONDS = 1;

function id(prefix: string): string {
  return `${prefix}-${globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

function failure(error: unknown): ToolResult {
  return {
    success: false,
    error: error instanceof Error ? error.message : String(error),
  };
}

function currentBaseComposition(compositionId: string) {
  const media = useMediaStore.getState();
  const base = media.compositions.find((composition) => composition.id === compositionId);
  if (!base?.timelineData) throw new Error(`Composition not found: ${compositionId}`);
  if (media.activeCompositionId !== compositionId) return base;
  return {
    ...base,
    timelineData: useTimelineStore.getState().getSerializableState(),
  };
}

function currentSnapshot(variantSet: TimelineVariantSet) {
  return captureVariantRangeSnapshot(createVariantTimelineSourceFromComposition({
    composition: currentBaseComposition(variantSet.baseCompositionId),
    scope: variantSet.scope,
    boundaryPaddingSeconds: DEFAULT_BOUNDARY_PADDING_SECONDS,
  }));
}

async function assertCurrentVariantBase(
  variantSet: TimelineVariantSet,
): Promise<ReturnType<typeof currentSnapshot>> {
  const snapshot = currentSnapshot(variantSet);
  const fingerprints = await fingerprintVariantRangeSnapshot(snapshot);
  if (
    fingerprints.scope.algorithm !== variantSet.baseFingerprint.algorithm
    || fingerprints.scope.value !== variantSet.baseFingerprint.value
    || fingerprints.boundary.algorithm !== variantSet.boundaryFingerprint.algorithm
    || fingerprints.boundary.value !== variantSet.boundaryFingerprint.value
  ) {
    useStoryboardStore.getState().putVariantSet({
      ...variantSet,
      status: 'stale',
    });
    throw new Error(
      `Variant set ${variantSet.id} is stale because its base range or boundary changed.`,
    );
  }
  return snapshot;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

function requiredStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`${field} must be a string array.`);
  }
  return [...new Set(value.map((entry) => String(entry).trim()).filter(Boolean))];
}

function requireRegisteredOption(
  variantSet: TimelineVariantSet,
  option: TimelineVariantOption,
): void {
  if (!variantSet.optionIds.includes(option.id)) {
    throw new Error(
      `Variant option ${option.id} is not registered in set ${variantSet.id}.`,
    );
  }
}

function getSet(variantSetId: string): TimelineVariantSet {
  const variantSet = useStoryboardStore.getState().variantSets[variantSetId];
  if (!variantSet) throw new Error(`Timeline variant set not found: ${variantSetId}`);
  return variantSet;
}

function getOption(optionId: string): TimelineVariantOption {
  const option = useStoryboardStore.getState().variantOptions[optionId];
  if (!option) throw new Error(`Timeline variant option not found: ${optionId}`);
  return option;
}

export async function handleCreateTimelineVariantSet(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    const timeline = useTimelineStore.getState();
    const media = useMediaStore.getState();
    const selection = timeline.timelineRangeSelection;
    if (!selection) throw new Error('Paint a timeline range before creating alternatives.');
    if (args.includeLinked !== undefined && typeof args.includeLinked !== 'boolean') {
      throw new Error('includeLinked must be a boolean.');
    }
    const baseCompositionId = media.activeCompositionId;
    if (!baseCompositionId) throw new Error('No active base composition.');
    const scope = {
      startTime: selection.startTime,
      endTime: selection.endTime,
      trackIds: [...selection.trackIds],
      includeLinked: args.includeLinked === undefined
        ? true
        : args.includeLinked,
    };
    const snapshot = captureVariantRangeSnapshot(
      createVariantTimelineSourceFromComposition({
        composition: currentBaseComposition(baseCompositionId),
        scope,
        boundaryPaddingSeconds: DEFAULT_BOUNDARY_PADDING_SECONDS,
      }),
    );
    const fingerprints = await fingerprintVariantRangeSnapshot(snapshot);
    const variantSet: TimelineVariantSet = {
      schemaVersion: 1,
      id: typeof args.id === 'string' && args.id.trim()
        ? args.id.trim()
        : id('timeline-variant-set'),
      title: requiredString(args.title, 'title'),
      baseCompositionId,
      sceneIds: requiredStringArray(args.sceneIds ?? [], 'sceneIds'),
      scope: snapshot.scope,
      baseFingerprint: fingerprints.scope,
      boundaryFingerprint: fingerprints.boundary,
      status: 'building',
      optionIds: [],
      createdAt: Date.now(),
    };
    if (useStoryboardStore.getState().variantSets[variantSet.id]) {
      throw new Error(`Timeline variant set already exists: ${variantSet.id}`);
    }
    useStoryboardStore.getState().putVariantSet(variantSet);
    return { success: true, data: variantSet };
  } catch (error) {
    return failure(error);
  }
}

export async function handleAddTimelineVariantOption(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    const variantSetId = requiredString(args.variantSetId, 'variantSetId');
    const variantSet = getSet(variantSetId);
    if (variantSet.status !== 'building' && variantSet.status !== 'review') {
      throw new Error(`Variant set ${variantSet.id} is not accepting options.`);
    }
    if (variantSet.optionIds.length >= 3) {
      throw new Error('A comparison variant set contains exactly three options.');
    }
    const option = {
      ...(args.option as Record<string, unknown> | undefined),
      schemaVersion: 1,
      id: typeof (args.option as Record<string, unknown> | undefined)?.id === 'string'
        ? String((args.option as Record<string, unknown>).id)
        : id('timeline-variant-option'),
      variantSetId,
    };
    assertTimelineVariantOption(option);
    const existing = useStoryboardStore.getState().variantOptions[option.id];
    if (existing || variantSet.optionIds.includes(option.id)) {
      throw new Error(`Timeline variant option already exists: ${option.id}`);
    }
    useStoryboardStore.getState().putVariantOption(option);
    useStoryboardStore.getState().putVariantSet({
      ...variantSet,
      optionIds: [...variantSet.optionIds, option.id],
    });
    return { success: true, data: option };
  } catch (error) {
    return failure(error);
  }
}

export async function handleMaterializeTimelineVariantOption(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    const option = getOption(requiredString(args.optionId, 'optionId'));
    const variantSet = getSet(option.variantSetId);
    requireRegisteredOption(variantSet, option);
    if (variantSet.optionIds.length !== 3) {
      throw new Error('Materialization requires exactly three registered options.');
    }
    const rangeSnapshot = await assertCurrentVariantBase(variantSet);
    const result = installMaterializedTimelineVariantOption({
      variantSet,
      option,
      rangeSnapshot,
    });
    return {
      success: true,
      data: {
        compositionId: result.graph.rootCompositionId,
        option: result.option,
        playable: result.playable,
        progress: result.progress,
        warnings: result.warnings,
      },
    };
  } catch (error) {
    return failure(error);
  }
}

export async function handleListTimelineVariantOptions(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    const variantSet = getSet(requiredString(args.variantSetId, 'variantSetId'));
    const state = useStoryboardStore.getState();
    const missingOptionIds = variantSet.optionIds.filter(
      (optionId) => !state.variantOptions[optionId],
    );
    if (missingOptionIds.length > 0) {
      throw new Error(
        `Variant set ${variantSet.id} references missing options: ${missingOptionIds.join(', ')}.`,
      );
    }
    return {
      success: true,
      data: {
        variantSet,
        options: variantSet.optionIds.flatMap((optionId) => (
          state.variantOptions[optionId] ? [state.variantOptions[optionId]] : []
        )),
      },
    };
  } catch (error) {
    return failure(error);
  }
}

export async function handleCommitTimelineVariantOption(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    const option = getOption(requiredString(args.optionId, 'optionId'));
    const variantSet = getSet(option.variantSetId);
    requireRegisteredOption(variantSet, option);
    if (
      args.boundaryPolicy !== undefined
      && args.boundaryPolicy !== 'preserve'
      && args.boundaryPolicy !== 'rebuild'
      && args.boundaryPolicy !== 'drop-with-warning'
    ) {
      throw new Error('boundaryPolicy must be preserve, rebuild, or drop-with-warning.');
    }
    const boundaryPolicy = args.boundaryPolicy ?? 'preserve';
    const result = await commitTimelineVariantOption({
      variantSet,
      option,
      currentRangeSnapshot: currentSnapshot(variantSet),
      boundaryPolicy,
    });
    return {
      success: true,
      data: {
        committedOptionId: result.option.id,
        insertedClipIds: result.insertedClipIds,
        variantSetId: result.variantSet.id,
        warnings: result.warnings,
      },
    };
  } catch (error) {
    return failure(error);
  }
}

export async function handleArchiveTimelineVariantSet(
  args: Record<string, unknown>,
): Promise<ToolResult> {
  try {
    const variantSet = getSet(requiredString(args.variantSetId, 'variantSetId'));
    const archived = archiveTimelineVariantSet(variantSet);
    useStoryboardStore.getState().putVariantSet(archived);
    return { success: true, data: archived };
  } catch (error) {
    return failure(error);
  }
}
