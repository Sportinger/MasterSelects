import type { Composition } from '../../../stores/mediaStore/types';
import type {
  SerializableClip,
  SerializableMarker,
  TimelineTrack,
} from '../../../types/timeline';
import type { Effect } from '../../../types/effects';
import type { Keyframe } from '../../../types/keyframes';
import type { ClipMask } from '../../../types/masks';
import type {
  StoryboardCandidateState,
  TimelineFragment,
  TimelineFragmentClip,
  TimelineVariantOption,
  TimelineVariantOptionState,
  TimelineVariantSet,
} from '../contracts';
import {
  cloneCompositionGraphForVariant,
  type ClonedVariantCompositionGraph,
  type VariantMaterializationIdFactory,
} from './compositionGraphClone';
import type { VariantRangeSnapshot } from './types';

const EPSILON = 0.000_001;

export interface MaterializedTimelineVariantOption {
  graph: ClonedVariantCompositionGraph;
  option: TimelineVariantOption;
  fragmentClipIds: string[];
  fragmentMarkerIds: string[];
  playable: boolean;
  progress: {
    readyCandidates: number;
    failedCandidates: number;
    pendingCandidates: number;
    totalCandidates: number;
  };
  warnings: string[];
}

export interface MaterializeTimelineVariantOptionInput {
  compositions: readonly Composition[];
  variantSet: TimelineVariantSet;
  option: TimelineVariantOption;
  rangeSnapshot: VariantRangeSnapshot;
  candidateStates?: Readonly<Record<string, StoryboardCandidateState>>;
  idFactory?: VariantMaterializationIdFactory;
}

export interface MaterializeTimelineVariantSetInput
  extends Omit<MaterializeTimelineVariantOptionInput, 'option'> {
  options: readonly TimelineVariantOption[];
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function graphKey(compositionId: string, sourceId: string): string {
  return `${compositionId}\u0000${sourceId}`;
}

function safeString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function safeNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function defaultTransform(): SerializableClip['transform'] {
  return {
    opacity: 1,
    blendMode: 'normal',
    position: { x: 0, y: 0, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    rotation: { x: 0, y: 0, z: 0 },
  };
}

function remapFragmentMaskProperty(
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

function createFragmentClip(
  fragmentClip: TimelineFragmentClip,
  fragment: TimelineFragment,
  option: TimelineVariantOption,
  scopeStart: number,
  localTrackIds: ReadonlyMap<string, string>,
  localClipIds: ReadonlyMap<string, string>,
  freshId: VariantMaterializationIdFactory,
): SerializableClip {
  const payload = clone(fragmentClip.payload) as unknown as Partial<SerializableClip>;
  const id = localClipIds.get(fragmentClip.localId);
  const trackId = localTrackIds.get(fragmentClip.localTrackId);
  if (!id || !trackId) {
    throw new Error(`Variant fragment clip ${fragmentClip.localId} has an invalid mapping.`);
  }
  const effects = fragment.effects
    .filter((entry) => entry.ownerClipId === fragmentClip.localId)
    .map((entry) => {
      const effect = clone(entry.payload) as unknown as Effect;
      return {
        ...effect,
        id: freshId('effect', `${fragmentClip.localId}:${safeString(effect.id, 'effect')}`),
      };
    });
  const maskIds = new Map<string, string>();
  const maskVertexIds = new Map<string, string>();
  const fragmentVertexId = (sourceId: string): string => {
    const existing = maskVertexIds.get(sourceId);
    if (existing) return existing;
    const created = freshId(
      'mask-vertex',
      `${fragmentClip.localId}:${safeString(sourceId, 'vertex')}`,
    );
    maskVertexIds.set(sourceId, created);
    return created;
  };
  const masks = fragment.masks
    .filter((entry) => entry.ownerClipId === fragmentClip.localId)
    .map((entry) => {
      const mask = clone(entry.payload) as unknown as ClipMask;
      const maskId = freshId(
        'mask',
        `${fragmentClip.localId}:${safeString(mask.id, 'mask')}`,
      );
      maskIds.set(mask.id, maskId);
      const vertices = (mask.vertices ?? []).map((vertex) => ({
        ...vertex,
        id: fragmentVertexId(vertex.id),
      }));
      const edgeFeathers = mask.edgeFeathers
        ? Object.fromEntries(
            Object.entries(mask.edgeFeathers).map(([edge, amount]) => {
              let mappedEdge = edge;
              for (const [sourceId, targetId] of maskVertexIds) {
                mappedEdge = mappedEdge.replaceAll(sourceId, targetId);
              }
              return [mappedEdge, amount];
            }),
          )
        : undefined;
      return {
        ...mask,
        id: maskId,
        vertices,
        ...(edgeFeathers === undefined ? {} : { edgeFeathers }),
      };
    });
  const keyframes = fragment.keyframes
    .filter((entry) => entry.ownerClipId === fragmentClip.localId)
    .map((entry) => {
      const keyframe = clone(entry.payload) as unknown as Keyframe;
      return {
        ...keyframe,
        id: freshId(
          'keyframe',
          `${fragmentClip.localId}:${safeString(keyframe.id, 'keyframe')}`,
        ),
        clipId: id,
        property: remapFragmentMaskProperty(keyframe.property, maskIds),
        ...(keyframe.pathValue === undefined
          ? {}
          : {
              pathValue: {
                ...keyframe.pathValue,
                vertices: keyframe.pathValue.vertices.map((vertex) => ({
                  ...vertex,
                  id: fragmentVertexId(vertex.id),
                })),
              },
            }),
      };
    });
  const duration = Math.max(EPSILON, fragmentClip.durationSeconds);
  const inPoint = safeNumber(payload.inPoint, 0);

  return {
    ...payload,
    id,
    trackId,
    name: safeString(payload.name, option.title),
    mediaFileId: typeof payload.mediaFileId === 'string' ? payload.mediaFileId : '',
    startTime: scopeStart + fragmentClip.startOffsetSeconds,
    duration,
    inPoint,
    outPoint: safeNumber(payload.outPoint, inPoint + duration),
    sourceType: payload.sourceType ?? 'video',
    transform: payload.transform ? clone(payload.transform) : defaultTransform(),
    effects,
    ...(masks.length === 0 ? {} : { masks }),
    ...(keyframes.length === 0 ? {} : { keyframes }),
    transitionIn: undefined,
    transitionOut: undefined,
  } as SerializableClip;
}

function applyFragmentLinksAndTransitions(
  clips: SerializableClip[],
  fragment: TimelineFragment,
  localClipIds: ReadonlyMap<string, string>,
  freshId: VariantMaterializationIdFactory,
): SerializableClip[] {
  const linkedByClipId = new Map<string, string>();
  for (const link of fragment.links) {
    const from = localClipIds.get(link.fromClipId);
    const to = localClipIds.get(link.toClipId);
    if (!from || !to) throw new Error('Variant fragment contains a dangling link.');
    linkedByClipId.set(from, to);
    linkedByClipId.set(to, from);
  }
  const transitionIn = new Map<string, SerializableClip['transitionIn']>();
  const transitionOut = new Map<string, SerializableClip['transitionOut']>();
  for (const [index, entry] of fragment.transitions.entries()) {
    const from = entry.fromClipId ? localClipIds.get(entry.fromClipId) : undefined;
    const to = entry.toClipId ? localClipIds.get(entry.toClipId) : undefined;
    if (!from || !to) {
      throw new Error(`Variant transition ${index + 1} must reference two fragment clips.`);
    }
    const payload = clone(entry.payload) as unknown as NonNullable<SerializableClip['transitionOut']>;
    const transition = {
      ...payload,
      id: freshId(
        'transition',
        safeString(payload.id, `${entry.fromClipId}:${entry.toClipId}`),
      ),
      duration: Math.max(EPSILON, safeNumber(payload.duration, 0.5)),
      type: safeString(payload.type, 'crossfade'),
    };
    transitionOut.set(from, { ...transition, linkedClipId: to });
    transitionIn.set(to, { ...transition, linkedClipId: from });
  }
  return clips.map((clip) => ({
    ...clip,
    ...(linkedByClipId.has(clip.id)
      ? { linkedClipId: linkedByClipId.get(clip.id) }
      : {}),
    ...(transitionIn.has(clip.id) ? { transitionIn: transitionIn.get(clip.id) } : {}),
    ...(transitionOut.has(clip.id) ? { transitionOut: transitionOut.get(clip.id) } : {}),
  }));
}

function cloneSplitOwnedIds(
  clip: SerializableClip,
  id: string,
  freshId: VariantMaterializationIdFactory,
): SerializableClip {
  const masks = clip.masks?.map((mask) => ({
    ...clone(mask),
    id: freshId('mask', `${id}:${mask.id}`),
    vertices: mask.vertices.map((vertex) => ({
      ...clone(vertex),
      id: freshId('mask-vertex', `${id}:${vertex.id}`),
    })),
  }));
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
          })),
        }),
  };
}

function trimBaseClipsForScope(
  clips: readonly SerializableClip[],
  targetClipIds: ReadonlySet<string>,
  startTime: number,
  endTime: number,
  freshId: VariantMaterializationIdFactory,
): { clips: SerializableClip[]; warnings: string[] } {
  const output: SerializableClip[] = [];
  const warnings: string[] = [];
  for (const clip of clips) {
    if (!targetClipIds.has(clip.id)) {
      output.push(clip);
      continue;
    }
    const clipEnd = clip.startTime + clip.duration;
    if (clipEnd <= startTime + EPSILON || clip.startTime >= endTime - EPSILON) {
      output.push(clip);
      continue;
    }
    const keepsLeft = clip.startTime < startTime - EPSILON;
    const keepsRight = clipEnd > endTime + EPSILON;
    if (keepsLeft) {
      const duration = startTime - clip.startTime;
      output.push({
        ...clip,
        duration,
        outPoint: clip.inPoint + duration,
        transitionOut: undefined,
        keyframes: clip.keyframes?.filter((keyframe) => keyframe.time <= duration),
      });
    }
    if (keepsRight) {
      const sourceDelta = endTime - clip.startTime;
      const rightId = freshId('clip', `${clip.id}:right`);
      const right = cloneSplitOwnedIds(clip, rightId, freshId);
      output.push({
        ...right,
        startTime: endTime,
        duration: clipEnd - endTime,
        inPoint: clip.inPoint + sourceDelta,
        transitionIn: undefined,
        keyframes: right.keyframes
          ?.filter((keyframe) => keyframe.time >= sourceDelta)
          .map((keyframe) => ({ ...keyframe, time: keyframe.time - sourceDelta })),
      });
    }
    if ((clip.transitionIn || clip.transitionOut) && (!keepsLeft || !keepsRight)) {
      warnings.push(`Dropped a base transition touching replaced clip ${clip.name}.`);
    }
  }
  const ids = new Set(output.map((clip) => clip.id));
  return {
    clips: output.map((clip) => ({
      ...clip,
      ...(clip.linkedClipId && !ids.has(clip.linkedClipId)
        ? { linkedClipId: undefined }
        : {}),
      ...(clip.transitionIn && !ids.has(clip.transitionIn.linkedClipId)
        ? { transitionIn: undefined }
        : {}),
      ...(clip.transitionOut && !ids.has(clip.transitionOut.linkedClipId)
        ? { transitionOut: undefined }
        : {}),
    })),
    warnings,
  };
}

function fragmentMarkers(
  fragment: TimelineFragment,
  scopeStart: number,
  scopeDuration: number,
  freshId: VariantMaterializationIdFactory,
): SerializableMarker[] {
  return fragment.markers.flatMap((marker, index) => {
    const localTime = typeof marker.time === 'number'
      ? marker.time
      : typeof marker.startOffsetSeconds === 'number'
        ? marker.startOffsetSeconds
        : undefined;
    if (
      localTime === undefined
      || !Number.isFinite(localTime)
      || localTime < -EPSILON
      || localTime > scopeDuration + EPSILON
    ) {
      throw new Error(`Variant marker ${index + 1} is outside the selected scope.`);
    }
    return [{
      ...clone(marker),
      id: freshId('marker', safeString(marker.id, String(index))),
      time: scopeStart + localTime,
      label: safeString(marker.label, `Variant marker ${index + 1}`),
      color: safeString(marker.color, '#8b7dff'),
    } as SerializableMarker];
  });
}

function candidateProgress(
  option: TimelineVariantOption,
  states: Readonly<Record<string, StoryboardCandidateState>>,
): MaterializedTimelineVariantOption['progress'] {
  let readyCandidates = 0;
  let failedCandidates = 0;
  let pendingCandidates = 0;
  for (const candidateId of option.candidateIds) {
    const state = states[candidateId] ?? 'proposed';
    if (state === 'ready' || state === 'accepted') readyCandidates += 1;
    else if (state === 'failed' || state === 'canceled' || state === 'rejected') {
      failedCandidates += 1;
    } else pendingCandidates += 1;
  }
  return {
    readyCandidates,
    failedCandidates,
    pendingCandidates,
    totalCandidates: option.candidateIds.length,
  };
}

function materializedState(
  option: TimelineVariantOption,
  progress: MaterializedTimelineVariantOption['progress'],
): TimelineVariantOptionState {
  if (option.state === 'rejected' || option.state === 'accepted') return option.state;
  if (progress.totalCandidates === 0) return 'ready';
  if (progress.readyCandidates === progress.totalCandidates) return 'ready';
  if (progress.failedCandidates === progress.totalCandidates) return 'failed';
  return 'building';
}

function validateMaterializationInput(
  input: MaterializeTimelineVariantOptionInput,
): Composition {
  if (input.option.variantSetId !== input.variantSet.id) {
    throw new Error('Variant option does not belong to the supplied set.');
  }
  if (input.rangeSnapshot.compositionId !== input.variantSet.baseCompositionId) {
    throw new Error('Variant range snapshot does not match the base composition.');
  }
  if (input.variantSet.baseCompositionId !== input.rangeSnapshot.source.compositionId) {
    throw new Error('Variant source snapshot composition does not match the set.');
  }
  const { scope } = input.variantSet;
  const snapshotScope = input.rangeSnapshot.scope;
  if (
    !Number.isFinite(scope.startTime)
    || !Number.isFinite(scope.endTime)
    || scope.endTime <= scope.startTime
  ) {
    throw new Error('Variant scope must be a finite, positive time range.');
  }
  if (
    scope.startTime !== snapshotScope.startTime
    || scope.endTime !== snapshotScope.endTime
    || scope.includeLinked !== snapshotScope.includeLinked
    || scope.trackIds.length !== snapshotScope.trackIds.length
    || scope.trackIds.some((trackId, index) => trackId !== snapshotScope.trackIds[index])
  ) {
    throw new Error('Variant set scope does not match its captured range snapshot.');
  }
  const base = input.compositions.find(
    (composition) => composition.id === input.variantSet.baseCompositionId,
  );
  if (!base?.timelineData) throw new Error('Variant base composition has no timeline data.');

  const fragment = input.option.fragment;
  const scopeDuration = scope.endTime - scope.startTime;
  if (
    !Number.isFinite(fragment.durationSeconds)
    || fragment.durationSeconds <= 0
    || fragment.durationSeconds > scopeDuration + EPSILON
  ) {
    throw new Error('Variant fragment duration is outside the selected scope.');
  }
  const allowedTracks = new Set(variantMaterializationSourceTrackIds(input));
  const baseTracks = new Map(base.timelineData.tracks.map((track) => [track.id, track]));
  const localTrackIds = new Set<string>();
  for (const track of fragment.tracks) {
    if (!track.localTrackId.trim() || localTrackIds.has(track.localTrackId)) {
      throw new Error(`Variant fragment track id ${track.localTrackId || '(empty)'} is invalid.`);
    }
    localTrackIds.add(track.localTrackId);
    if (!allowedTracks.has(track.sourceTrackId)) {
      throw new Error(
        `Variant fragment source track ${track.sourceTrackId} is outside the selected scope.`,
      );
    }
    const baseTrack = baseTracks.get(track.sourceTrackId);
    if (!baseTrack || baseTrack.type !== track.kind) {
      throw new Error(`Variant fragment source track ${track.sourceTrackId} has an invalid kind.`);
    }
  }
  const localClipIds = new Set<string>();
  for (const clip of fragment.clips) {
    if (!clip.localId.trim() || localClipIds.has(clip.localId)) {
      throw new Error(`Variant fragment clip id ${clip.localId || '(empty)'} is invalid.`);
    }
    localClipIds.add(clip.localId);
    if (!localTrackIds.has(clip.localTrackId)) {
      throw new Error(`Variant fragment clip ${clip.localId} references a missing track.`);
    }
    if (
      !Number.isFinite(clip.startOffsetSeconds)
      || !Number.isFinite(clip.durationSeconds)
      || clip.startOffsetSeconds < -EPSILON
      || clip.durationSeconds <= 0
      || clip.startOffsetSeconds + clip.durationSeconds > scopeDuration + EPSILON
    ) {
      throw new Error(`Variant fragment clip ${clip.localId} is outside the selected scope.`);
    }
  }
  for (const owned of [...fragment.effects, ...fragment.masks, ...fragment.keyframes]) {
    if (!localClipIds.has(owned.ownerClipId)) {
      throw new Error(`Variant fragment owned payload references missing clip ${owned.ownerClipId}.`);
    }
  }
  for (const link of fragment.links) {
    if (
      link.fromClipId === link.toClipId
      || !localClipIds.has(link.fromClipId)
      || !localClipIds.has(link.toClipId)
    ) {
      throw new Error('Variant fragment contains an invalid linked-clip relationship.');
    }
  }
  for (const transition of fragment.transitions) {
    if (
      !transition.fromClipId
      || !transition.toClipId
      || transition.fromClipId === transition.toClipId
      || !localClipIds.has(transition.fromClipId)
      || !localClipIds.has(transition.toClipId)
    ) {
      throw new Error('Variant fragment contains an invalid internal transition.');
    }
  }
  return base;
}

export function materializeTimelineVariantOption(
  input: MaterializeTimelineVariantOptionInput,
): MaterializedTimelineVariantOption {
  const base = validateMaterializationInput(input);
  const suppliedFactory = input.idFactory;
  const factory: VariantMaterializationIdFactory | undefined = suppliedFactory
    ? (kind, sourceId) => suppliedFactory(kind, `${input.option.id}:${sourceId}`)
    : undefined;
  const graph = cloneCompositionGraphForVariant(
    input.compositions,
    base.id,
    factory,
  );
  const rootIndex = graph.compositions.findIndex(
    (composition) => composition.id === graph.rootCompositionId,
  );
  const root = graph.compositions[rootIndex];
  if (!root?.timelineData) throw new Error('Cloned variant composition has no timeline data.');

  const rawFreshId: VariantMaterializationIdFactory = factory
    ?? ((kind, sourceId) => (
        `${graph.rootCompositionId}:${kind}:${sourceId}:${globalThis.crypto?.randomUUID?.()
          ?? Math.random().toString(36).slice(2)}`
      ));
  const usedIds = new Set(
    Object.values(graph.idMap).flatMap((record) => Object.values(record)),
  );
  const freshId: VariantMaterializationIdFactory = (kind, sourceId) => {
    const created = rawFreshId(kind, sourceId);
    if (!created.trim()) throw new Error(`Variant ${kind} id factory returned an empty id.`);
    if (usedIds.has(created)) {
      throw new Error(`Variant id factory returned duplicate id ${created}.`);
    }
    usedIds.add(created);
    return created;
  };
  const localTrackIds = new Map<string, string>();
  for (const track of input.option.fragment.tracks) {
    const mapped = graph.idMap.trackIds[
      graphKey(base.id, track.sourceTrackId)
    ];
    if (!mapped) {
      throw new Error(`Variant fragment references missing source track ${track.sourceTrackId}.`);
    }
    localTrackIds.set(track.localTrackId, mapped);
  }
  const localClipIds = new Map(
    input.option.fragment.clips.map((clip) => [
      clip.localId,
      freshId('clip', `fragment:${clip.localId}`),
    ]),
  );
  const fragmentClips = applyFragmentLinksAndTransitions(
    input.option.fragment.clips.map((clip) => createFragmentClip(
      clip,
      input.option.fragment,
      input.option,
      input.variantSet.scope.startTime,
      localTrackIds,
      localClipIds,
      freshId,
    )),
    input.option.fragment,
    localClipIds,
    freshId,
  );
  const targetClipIds = new Set(
    input.rangeSnapshot.capturedClips
      .map((captured) => graph.idMap.clipIds[graphKey(base.id, captured.clipId)])
      .filter((clipId): clipId is string => clipId !== undefined),
  );
  const trimmed = trimBaseClipsForScope(
    root.timelineData.clips,
    targetClipIds,
    input.variantSet.scope.startTime,
    input.variantSet.scope.endTime,
    freshId,
  );
  const materializedFragmentMarkers = fragmentMarkers(
    input.option.fragment,
    input.variantSet.scope.startTime,
    input.variantSet.scope.endTime - input.variantSet.scope.startTime,
    freshId,
  );
  const markers = [
    ...(root.timelineData.markers ?? []),
    ...materializedFragmentMarkers,
  ].toSorted((left, right) => left.time - right.time || left.id.localeCompare(right.id));
  const warnings = [
    ...input.option.fragment.warnings,
    ...trimmed.warnings,
    ...(input.option.fragment.annotations.length > 0
      ? ['Annotations remain canonical on the variant and are not rendered by the composition adapter.']
      : []),
  ];
  const materializedRoot: Composition = {
    ...root,
    name: `${base.name} · ${input.option.title}`,
    timelineData: {
      ...root.timelineData,
      clips: [...trimmed.clips, ...fragmentClips].toSorted((left, right) => (
        left.startTime - right.startTime
        || left.trackId.localeCompare(right.trackId)
        || left.id.localeCompare(right.id)
      )),
      markers,
      playheadPosition: input.variantSet.scope.startTime,
      inPoint: input.variantSet.scope.startTime,
      outPoint: input.variantSet.scope.endTime,
      loopPlayback: true,
    },
  };
  graph.compositions[rootIndex] = materializedRoot;
  const progress = candidateProgress(input.option, input.candidateStates ?? {});
  const option: TimelineVariantOption = {
    ...clone(input.option),
    state: materializedState(input.option, progress),
    materializedCompositionId: graph.rootCompositionId,
  };
  return {
    graph,
    option,
    fragmentClipIds: fragmentClips.map((clip) => clip.id),
    fragmentMarkerIds: materializedFragmentMarkers.map((marker) => marker.id),
    playable: option.state !== 'failed',
    progress,
    warnings,
  };
}

export function materializeTimelineVariantSet(
  input: MaterializeTimelineVariantSetInput,
): MaterializedTimelineVariantOption[] {
  if (input.options.length !== 3) {
    throw new Error('A comparison variant set must materialize exactly three options.');
  }
  const optionIds = new Set(input.options.map((option) => option.id));
  if (optionIds.size !== 3) throw new Error('Variant option IDs must be unique.');
  return input.options.map((option) => materializeTimelineVariantOption({
    ...input,
    option,
  }));
}

export function variantMaterializationSourceTrackIds(
  input: MaterializeTimelineVariantOptionInput,
): string[] {
  return [...new Set([
    ...input.variantSet.scope.trackIds,
    ...input.rangeSnapshot.linkedExpansionTrackIds,
  ])].sort();
}

export function variantFragmentTargetTracks(
  fragment: TimelineFragment,
  tracks: readonly TimelineTrack[],
): TimelineTrack[] {
  const sourceIds = new Set(fragment.tracks.map((track) => track.sourceTrackId));
  return tracks.filter((track) => sourceIds.has(track.id));
}
