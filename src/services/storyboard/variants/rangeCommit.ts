import type { Composition } from '../../../stores/mediaStore/types';
import type {
  SerializableClip,
  SerializableMarker,
} from '../../../types/timeline';
import type { Keyframe } from '../../../types/keyframes';
import type {
  StoryboardFingerprint,
  StoryboardProjectState,
  TimelineVariantOption,
  TimelineVariantSet,
} from '../contracts';
import {
  materializeTimelineVariantOption,
  type MaterializeTimelineVariantOptionInput,
} from './materialization';
import {
  fingerprintVariantRangeSnapshot,
} from './fingerprints';
import { variantScopesEqual } from './scope';
import type {
  VariantBoundaryMutationPolicy,
  VariantRangeSnapshot,
} from './types';
import type {
  VariantMaterializationIdFactory,
  VariantMaterializationIdKind,
} from './compositionGraphClone';

const EPSILON = 0.000_001;

export class StaleTimelineVariantError extends Error {
  readonly code = 'STALE_TIMELINE_VARIANT';
  readonly variantSet: TimelineVariantSet;

  constructor(
    message: string,
    variantSet: TimelineVariantSet,
  ) {
    super(message);
    this.name = 'StaleTimelineVariantError';
    this.variantSet = variantSet;
  }
}

export interface ReplaceTimelineRangeWithVariantInput
  extends Pick<
    MaterializeTimelineVariantOptionInput,
    'compositions' | 'candidateStates' | 'idFactory'
  > {
  variantSet: TimelineVariantSet;
  option: TimelineVariantOption;
  currentRangeSnapshot: VariantRangeSnapshot;
  boundaryPolicy: VariantBoundaryMutationPolicy;
  storyboardState?: StoryboardProjectState;
  now?: number;
}

export interface ReplaceTimelineRangeWithVariantResult {
  baseComposition: Composition;
  storyboardState?: StoryboardProjectState;
  variantSet: TimelineVariantSet;
  option: TimelineVariantOption;
  insertedClipIds: string[];
  sourceClipIdentityByClipId: Record<string, string>;
  warnings: string[];
}

interface ClipPart {
  clip: SerializableClip;
  sourceClipId: string;
  side: 'whole' | 'left' | 'right';
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function fingerprintsEqual(
  left: StoryboardFingerprint,
  right: StoryboardFingerprint,
): boolean {
  return left.schemaVersion === right.schemaVersion
    && left.algorithm === right.algorithm
    && left.value === right.value;
}

function defaultCommitIdFactory(
  kind: VariantMaterializationIdKind,
  sourceId: string,
): string {
  return `commit-${kind}-${sourceId}-${globalThis.crypto?.randomUUID?.()
    ?? Math.random().toString(36).slice(2)}`;
}

function uniqueFactory(
  input: VariantMaterializationIdFactory | undefined,
  optionId: string,
  existingIds: Iterable<string>,
): VariantMaterializationIdFactory {
  const used = new Set(existingIds);
  const factory = input
    ? (kind: VariantMaterializationIdKind, sourceId: string) => (
        input(kind, `commit:${optionId}:${sourceId}`)
      )
    : defaultCommitIdFactory;
  return (kind, sourceId) => {
    const id = factory(kind, sourceId);
    if (!id.trim()) throw new Error(`Variant ${kind} id factory returned an empty id.`);
    if (used.has(id)) throw new Error(`Variant commit produced duplicate id ${id}.`);
    used.add(id);
    return id;
  };
}

function remapMaskProperty(
  property: Keyframe['property'],
  maskIds: ReadonlyMap<string, string>,
): Keyframe['property'] {
  const value = String(property);
  for (const [sourceId, targetId] of maskIds) {
    if (value === `mask.${sourceId}.path`) {
      return `mask.${targetId}.path` as Keyframe['property'];
    }
  }
  return property;
}

function cloneOwnedClip(
  clip: SerializableClip,
  id: string,
  freshId: VariantMaterializationIdFactory,
): SerializableClip {
  const maskIds = new Map<string, string>();
  const vertexIds = new Map<string, string>();
  const masks = clip.masks?.map((mask) => {
    const maskId = freshId('mask', `${id}:${mask.id}`);
    maskIds.set(mask.id, maskId);
    const vertices = mask.vertices.map((vertex) => {
      const vertexId = freshId('mask-vertex', `${id}:${vertex.id}`);
      vertexIds.set(vertex.id, vertexId);
      return { ...clone(vertex), id: vertexId };
    });
    return {
      ...clone(mask),
      id: maskId,
      vertices,
      ...(mask.edgeFeathers === undefined
        ? {}
        : {
            edgeFeathers: Object.fromEntries(
              Object.entries(mask.edgeFeathers).map(([edge, amount]) => {
                let mappedEdge = edge;
                for (const [sourceId, targetId] of vertexIds) {
                  mappedEdge = mappedEdge.replaceAll(sourceId, targetId);
                }
                return [mappedEdge, amount];
              }),
            ),
          }),
    };
  });
  return {
    ...clone(clip),
    id,
    effects: clip.effects.map((effect) => ({
      ...clone(effect),
      id: freshId('effect', `${id}:${effect.id}`),
    })),
    ...(masks === undefined ? {} : { masks }),
    ...(clip.keyframes === undefined
      ? {}
      : {
          keyframes: clip.keyframes.map((keyframe) => ({
            ...clone(keyframe),
            id: freshId('keyframe', `${id}:${keyframe.id}`),
            clipId: id,
            property: remapMaskProperty(keyframe.property, maskIds),
            ...(keyframe.pathValue === undefined
              ? {}
              : {
                  pathValue: {
                    ...clone(keyframe.pathValue),
                    vertices: keyframe.pathValue.vertices.map((vertex) => ({
                      ...clone(vertex),
                      id: vertexIds.get(vertex.id)
                        ?? freshId('mask-vertex', `${id}:path:${vertex.id}`),
                    })),
                  },
                }),
          })),
        }),
  };
}

function splitBaseClips(
  clips: readonly SerializableClip[],
  capturedClipIds: ReadonlySet<string>,
  startTime: number,
  endTime: number,
  freshId: VariantMaterializationIdFactory,
): ClipPart[] {
  const parts: ClipPart[] = [];
  for (const original of clips) {
    if (!capturedClipIds.has(original.id)) {
      parts.push({ clip: clone(original), sourceClipId: original.id, side: 'whole' });
      continue;
    }
    const clipEnd = original.startTime + original.duration;
    if (clipEnd <= startTime + EPSILON || original.startTime >= endTime - EPSILON) {
      parts.push({ clip: clone(original), sourceClipId: original.id, side: 'whole' });
      continue;
    }
    if (original.startTime < startTime - EPSILON) {
      const duration = startTime - original.startTime;
      parts.push({
        sourceClipId: original.id,
        side: 'left',
        clip: {
          ...clone(original),
          duration,
          outPoint: original.inPoint + duration,
          transitionOut: undefined,
          keyframes: original.keyframes?.filter((keyframe) => keyframe.time <= duration),
        },
      });
    }
    if (clipEnd > endTime + EPSILON) {
      const sourceDelta = endTime - original.startTime;
      const id = freshId('clip', `${original.id}:right`);
      const right = cloneOwnedClip(original, id, freshId);
      parts.push({
        sourceClipId: original.id,
        side: 'right',
        clip: {
          ...right,
          startTime: endTime,
          duration: clipEnd - endTime,
          inPoint: original.inPoint + sourceDelta,
          transitionIn: undefined,
          keyframes: right.keyframes
            ?.filter((keyframe) => keyframe.time >= sourceDelta)
            .map((keyframe) => ({ ...keyframe, time: keyframe.time - sourceDelta })),
        },
      });
    }
  }

  const bySourceAndSide = new Map(
    parts.map((part) => [`${part.sourceClipId}:${part.side}`, part.clip.id]),
  );
  const existingIds = new Set(parts.map((part) => part.clip.id));
  return parts.map((part) => {
    const originalLink = clips.find((clip) => clip.id === part.sourceClipId)?.linkedClipId;
    const mappedLink = originalLink
      ? bySourceAndSide.get(`${originalLink}:${part.side}`)
        ?? bySourceAndSide.get(`${originalLink}:whole`)
      : undefined;
    const clip = {
      ...part.clip,
      ...(mappedLink && existingIds.has(mappedLink)
        ? { linkedClipId: mappedLink }
        : { linkedClipId: undefined }),
    };
    return { ...part, clip };
  });
}

interface BoundaryTransition {
  id: string;
  trackId: string;
  boundary: 'start' | 'end';
  template: NonNullable<SerializableClip['transitionOut']>;
}

function collectBoundaryTransitions(
  clips: readonly SerializableClip[],
  capturedClipIds: ReadonlySet<string>,
  startTime: number,
  endTime: number,
): BoundaryTransition[] {
  const collected = new Map<string, BoundaryTransition>();
  for (const clip of clips) {
    for (const entry of [
      clip.transitionIn
        ? { transition: clip.transitionIn, time: clip.startTime }
        : undefined,
      clip.transitionOut
        ? { transition: clip.transitionOut, time: clip.startTime + clip.duration }
        : undefined,
    ]) {
      if (!entry) continue;
      if (!capturedClipIds.has(clip.id) && !capturedClipIds.has(entry.transition.linkedClipId)) {
        continue;
      }
      const boundary = Math.abs(entry.time - startTime) <= EPSILON
        ? 'start'
        : Math.abs(entry.time - endTime) <= EPSILON
          ? 'end'
          : undefined;
      if (!boundary) continue;
      collected.set(`${entry.transition.id}:${boundary}`, {
        id: entry.transition.id,
        trackId: clip.trackId,
        boundary,
        template: clone(entry.transition),
      });
    }
  }
  return [...collected.values()];
}

function withoutTransitions(
  clip: SerializableClip,
  transitionIds: ReadonlySet<string>,
): SerializableClip {
  return {
    ...clip,
    ...(clip.transitionIn && transitionIds.has(clip.transitionIn.id)
      ? { transitionIn: undefined }
      : {}),
    ...(clip.transitionOut && transitionIds.has(clip.transitionOut.id)
      ? { transitionOut: undefined }
      : {}),
  };
}

function reconcileBoundaryTransitions(
  clips: SerializableClip[],
  boundaries: readonly BoundaryTransition[],
  policy: VariantBoundaryMutationPolicy,
  startTime: number,
  endTime: number,
  freshId: VariantMaterializationIdFactory,
): { clips: SerializableClip[]; warnings: string[] } {
  if (boundaries.length === 0) return { clips, warnings: [] };
  if (policy === 'preserve') {
    throw new Error(
      'Boundary transitions touch the selected range; choose rebuild or drop-with-warning.',
    );
  }
  const transitionIds = new Set(boundaries.map((entry) => entry.id));
  let output = clips.map((clip) => withoutTransitions(clip, transitionIds));
  const warnings: string[] = [];
  if (policy === 'drop-with-warning') {
    return {
      clips: output,
      warnings: boundaries.map((entry) => (
        `Dropped boundary transition ${entry.id} at the ${entry.boundary} boundary.`
      )),
    };
  }

  for (const boundary of boundaries) {
    const time = boundary.boundary === 'start' ? startTime : endTime;
    const before = output
      .filter((clip) => (
        clip.trackId === boundary.trackId
        && Math.abs(clip.startTime + clip.duration - time) <= EPSILON
      ))
      .toSorted((left, right) => right.startTime - left.startTime)[0];
    const after = output
      .filter((clip) => (
        clip.trackId === boundary.trackId
        && Math.abs(clip.startTime - time) <= EPSILON
      ))
      .toSorted((left, right) => left.startTime - right.startTime)[0];
    if (!before || !after || before.id === after.id) {
      warnings.push(
        `Could not rebuild boundary transition ${boundary.id}; it was dropped.`,
      );
      continue;
    }
    const transition = {
      ...clone(boundary.template),
      id: freshId('transition', `${boundary.id}:${boundary.boundary}`),
      compositionId: undefined,
    };
    output = output.map((clip) => {
      if (clip.id === before.id) {
        return { ...clip, transitionOut: { ...transition, linkedClipId: after.id } };
      }
      if (clip.id === after.id) {
        return { ...clip, transitionIn: { ...transition, linkedClipId: before.id } };
      }
      return clip;
    });
  }
  return { clips: output, warnings };
}

function updateStoryboardState(
  state: StoryboardProjectState,
  variantSet: TimelineVariantSet,
  option: TimelineVariantOption,
  inserted: readonly SerializableClip[],
  now: number,
): StoryboardProjectState {
  const sceneIds = new Set([...variantSet.sceneIds, ...option.fragment.sceneIds]);
  const scenes = { ...state.scenes };
  for (const sceneId of sceneIds) {
    const scene = scenes[sceneId];
    if (!scene) continue;
    const explicitSceneClips = inserted.filter(
      (clip) => clip.storyboardProperties?.sceneId === sceneId,
    );
    const filled = explicitSceneClips.length > 0
      ? explicitSceneClips
      : sceneIds.size === 1
        ? inserted
        : [];
    const selectedCandidateId = option.candidateIds.find(
      (candidateId) => state.candidates[candidateId]?.state === 'accepted',
    ) ?? option.candidateIds[0] ?? scene.selectedCandidateId;
    scenes[sceneId] = {
      ...scene,
      status: filled.length > 0 ? 'filled' : scene.status,
      filledClipIds: filled.map((clip) => clip.id),
      ...(selectedCandidateId ? { selectedCandidateId } : {}),
      variantSetIds: [...new Set([...scene.variantSetIds, variantSet.id])],
      updatedAt: now,
    };
  }
  return {
    ...state,
    scenes,
    variantSets: {
      ...state.variantSets,
      [variantSet.id]: variantSet,
    },
    variantOptions: {
      ...state.variantOptions,
      [option.id]: option,
    },
  };
}

export async function replaceTimelineRangeWithVariant(
  input: ReplaceTimelineRangeWithVariantInput,
): Promise<ReplaceTimelineRangeWithVariantResult> {
  const base = input.compositions.find(
    (composition) => composition.id === input.variantSet.baseCompositionId,
  );
  if (!base?.timelineData) throw new Error('Variant base composition has no timeline data.');
  if (input.option.variantSetId !== input.variantSet.id) {
    throw new Error('Variant option does not belong to the supplied set.');
  }
  if (input.option.state === 'failed' || input.option.state === 'rejected') {
    throw new Error(`Variant option ${input.option.id} is not committable.`);
  }
  if (
    input.currentRangeSnapshot.compositionId !== base.id
    || !variantScopesEqual(input.currentRangeSnapshot.scope, input.variantSet.scope)
  ) {
    throw new StaleTimelineVariantError('Variant range no longer matches the base scope.', {
      ...input.variantSet,
      status: 'stale',
    });
  }
  const currentFingerprints = await fingerprintVariantRangeSnapshot(
    input.currentRangeSnapshot,
  );
  if (
    !fingerprintsEqual(currentFingerprints.scope, input.variantSet.baseFingerprint)
    || !fingerprintsEqual(
      currentFingerprints.boundary,
      input.variantSet.boundaryFingerprint,
    )
  ) {
    throw new StaleTimelineVariantError(
      'Variant base or boundary changed after the option was built.',
      { ...input.variantSet, status: 'stale' },
    );
  }

  const existingIds = [
    ...input.compositions.map((composition) => composition.id),
    ...input.compositions.flatMap((composition) => (
      composition.timelineData?.clips.map((clip) => clip.id) ?? []
    )),
  ];
  const freshId = uniqueFactory(input.idFactory, input.option.id, existingIds);
  const materialized = materializeTimelineVariantOption({
    compositions: input.compositions,
    variantSet: input.variantSet,
    option: input.option,
    rangeSnapshot: input.currentRangeSnapshot,
    candidateStates: input.candidateStates,
    idFactory: freshId,
  });
  if (!materialized.playable) {
    throw new Error(`Variant option ${input.option.id} has no playable result.`);
  }
  const materializedRoot = materialized.graph.compositions.find(
    (composition) => composition.id === materialized.graph.rootCompositionId,
  );
  if (!materializedRoot?.timelineData) {
    throw new Error('Variant materialization did not produce a root timeline.');
  }
  const fragmentIds = new Set(materialized.fragmentClipIds);
  const reverseTrackIds = new Map(
    Object.entries(materialized.graph.idMap.trackIds)
      .filter(([sourceKey]) => sourceKey.startsWith(`${base.id}\u0000`))
      .map(([sourceKey, mappedId]) => [
        mappedId,
        sourceKey.slice(base.id.length + 1),
      ]),
  );
  const inserted = materializedRoot.timelineData.clips
    .filter((clip) => fragmentIds.has(clip.id))
    .map((clip) => ({
      ...clone(clip),
      trackId: reverseTrackIds.get(clip.trackId) ?? clip.trackId,
    }));
  const capturedClipIds = new Set(
    input.currentRangeSnapshot.capturedClips.map((captured) => captured.clipId),
  );
  const boundaryTransitions = collectBoundaryTransitions(
    base.timelineData.clips,
    capturedClipIds,
    input.variantSet.scope.startTime,
    input.variantSet.scope.endTime,
  );
  const parts = splitBaseClips(
    base.timelineData.clips,
    capturedClipIds,
    input.variantSet.scope.startTime,
    input.variantSet.scope.endTime,
    freshId,
  );
  const reconciled = reconcileBoundaryTransitions(
    [...parts.map((part) => part.clip), ...inserted],
    boundaryTransitions,
    input.boundaryPolicy,
    input.variantSet.scope.startTime,
    input.variantSet.scope.endTime,
    freshId,
  );
  const fragmentMarkerIds = new Set(materialized.fragmentMarkerIds);
  const fragmentMarkers = (materializedRoot.timelineData.markers ?? [])
    .filter((marker) => fragmentMarkerIds.has(marker.id))
    .map((marker) => clone(marker));
  const markers: SerializableMarker[] = [
    ...(base.timelineData.markers ?? []).filter((marker) => (
      marker.time < input.variantSet.scope.startTime
      || marker.time > input.variantSet.scope.endTime
    )),
    ...fragmentMarkers,
  ].toSorted((left, right) => left.time - right.time || left.id.localeCompare(right.id));
  const committedSet: TimelineVariantSet = {
    ...clone(input.variantSet),
    status: 'committed',
    committedOptionId: input.option.id,
  };
  const committedOption: TimelineVariantOption = {
    ...clone(materialized.option),
    state: 'accepted',
  };
  const baseComposition: Composition = {
    ...clone(base),
    timelineData: {
      ...clone(base.timelineData),
      clips: reconciled.clips.toSorted((left, right) => (
        left.startTime - right.startTime
        || left.trackId.localeCompare(right.trackId)
        || left.id.localeCompare(right.id)
      )),
      markers,
    },
  };
  const sourceClipIdentityByClipId = Object.fromEntries([
    ...parts.map((part) => [part.clip.id, part.sourceClipId] as const),
    ...inserted.map((clip) => [clip.id, clip.id] as const),
  ]);
  const storyboardState = input.storyboardState
    ? updateStoryboardState(
        input.storyboardState,
        committedSet,
        committedOption,
        inserted,
        input.now ?? Date.now(),
      )
    : undefined;

  return {
    baseComposition,
    ...(storyboardState ? { storyboardState } : {}),
    variantSet: committedSet,
    option: committedOption,
    insertedClipIds: inserted.map((clip) => clip.id),
    sourceClipIdentityByClipId,
    warnings: [...materialized.warnings, ...reconciled.warnings],
  };
}

export function archiveTimelineVariantSet(
  variantSet: TimelineVariantSet,
): TimelineVariantSet {
  if (variantSet.status === 'committed') {
    throw new Error('A committed variant set cannot be archived as an unchosen comparison.');
  }
  return { ...clone(variantSet), status: 'archived' };
}

export async function rebaseTimelineVariantSet(
  variantSet: TimelineVariantSet,
  currentRangeSnapshot: VariantRangeSnapshot,
): Promise<TimelineVariantSet> {
  if (
    currentRangeSnapshot.compositionId !== variantSet.baseCompositionId
    || !variantScopesEqual(currentRangeSnapshot.scope, variantSet.scope)
  ) {
    throw new Error('Cannot rebase a variant set onto a different composition or scope.');
  }
  const fingerprints = await fingerprintVariantRangeSnapshot(currentRangeSnapshot);
  return {
    ...clone(variantSet),
    status: 'building',
    baseFingerprint: fingerprints.scope,
    boundaryFingerprint: fingerprints.boundary,
    committedOptionId: undefined,
  };
}
