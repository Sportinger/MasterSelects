import {
  assertTimelineVariantOption,
  assertTimelineVariantSet,
  isPlainRecord,
  type TimelineVariantOption,
  type TimelineVariantSet,
} from '../../services/storyboard/contracts';
import { captureVariantRangeSnapshot } from '../../services/storyboard/variants/rangeSnapshot';
import type {
  StoryboardVariantWorkspaceState,
  VariantRangeSnapshot,
} from '../../services/storyboard/variants/types';

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isPlainRecord(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function restoreCollection<T>(
  value: unknown,
  label: string,
  validate: (entry: unknown, path: string) => asserts entry is T,
  identity: (entry: T) => string,
): Record<string, T> {
  const collection = record(value, label);
  const restored: Record<string, T> = {};
  for (const [key, entry] of Object.entries(collection)) {
    validate(entry, `${label}.${key}`);
    if (identity(entry) !== key) throw new Error(`${label}.${key} has a mismatched id.`);
    restored[key] = clone(entry);
  }
  return restored;
}

function restoreSnapshots(value: unknown): Record<string, VariantRangeSnapshot> {
  const collection = record(value, 'rangeSnapshots');
  const restored: Record<string, VariantRangeSnapshot> = {};
  for (const [variantSetId, entry] of Object.entries(collection)) {
    const snapshot = record(entry, `rangeSnapshots.${variantSetId}`);
    const canonical = captureVariantRangeSnapshot(
      snapshot.source as VariantRangeSnapshot['source'],
    );
    const expectedDerived = {
      schemaVersion: snapshot.schemaVersion,
      compositionId: snapshot.compositionId,
      scope: snapshot.scope,
      boundaryPaddingSeconds: snapshot.boundaryPaddingSeconds,
      linkedExpansionPolicy: snapshot.linkedExpansionPolicy,
      linkedExpansionClipIds: snapshot.linkedExpansionClipIds,
      linkedExpansionTrackIds: snapshot.linkedExpansionTrackIds,
      capturedClips: snapshot.capturedClips,
    };
    const canonicalDerived = {
      schemaVersion: canonical.schemaVersion,
      compositionId: canonical.compositionId,
      scope: canonical.scope,
      boundaryPaddingSeconds: canonical.boundaryPaddingSeconds,
      linkedExpansionPolicy: canonical.linkedExpansionPolicy,
      linkedExpansionClipIds: canonical.linkedExpansionClipIds,
      linkedExpansionTrackIds: canonical.linkedExpansionTrackIds,
      capturedClips: canonical.capturedClips,
    };
    if (JSON.stringify(expectedDerived) !== JSON.stringify(canonicalDerived)) {
      throw new Error(`rangeSnapshots.${variantSetId} is not a canonical capture.`);
    }
    restored[variantSetId] = canonical;
  }
  return restored;
}

export function restoreStoryboardVariantState(value: unknown): StoryboardVariantWorkspaceState {
  const state = record(value, 'variantWorkspace');
  if (state.schemaVersion !== 1) throw new Error('Unsupported variant workspace schemaVersion.');
  const variantSets = restoreCollection<TimelineVariantSet>(
    state.variantSets,
    'variantSets',
    assertTimelineVariantSet,
    (entry) => entry.id,
  );
  const variantOptions = restoreCollection<TimelineVariantOption>(
    state.variantOptions,
    'variantOptions',
    assertTimelineVariantOption,
    (entry) => entry.id,
  );
  const rangeSnapshots = restoreSnapshots(state.rangeSnapshots);
  for (const [optionId, option] of Object.entries(variantOptions)) {
    const variantSet = variantSets[option.variantSetId];
    if (!variantSet || !variantSet.optionIds.includes(optionId)) {
      throw new Error(`Variant option ${optionId} is not registered by its set.`);
    }
  }
  for (const variantSetId of Object.keys(rangeSnapshots)) {
    if (!variantSets[variantSetId]) {
      throw new Error(`Range snapshot references missing set ${variantSetId}.`);
    }
  }
  return {
    schemaVersion: 1,
    variantSets,
    variantOptions,
    rangeSnapshots,
  };
}

export function serializeStoryboardVariantState(
  state: StoryboardVariantWorkspaceState,
): string {
  return JSON.stringify(restoreStoryboardVariantState(state));
}
