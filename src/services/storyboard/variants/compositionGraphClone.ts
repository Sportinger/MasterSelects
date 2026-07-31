import type { Composition } from '../../../stores/mediaStore/types';
import type {
  SerializableClip,
  SerializableMarker,
  TimelineTrack,
} from '../../../types/timeline';
import type { Keyframe } from '../../../types/keyframes';
import type { ClipMask, MaskPathKeyframeValue, MaskVertex } from '../../../types/masks';
import type { TimelineTransition, TransitionSourceMap } from '../../../types/timelineCore';

export type VariantMaterializationIdKind =
  | 'composition'
  | 'track'
  | 'clip'
  | 'linked-group'
  | 'effect'
  | 'mask'
  | 'mask-vertex'
  | 'keyframe'
  | 'transition'
  | 'marker';

export type VariantMaterializationIdFactory = (
  kind: VariantMaterializationIdKind,
  sourceId: string,
) => string;

export interface VariantCompositionGraphIdMap {
  compositionIds: Record<string, string>;
  trackIds: Record<string, string>;
  clipIds: Record<string, string>;
  linkedGroupIds: Record<string, string>;
  effectIds: Record<string, string>;
  maskIds: Record<string, string>;
  maskVertexIds: Record<string, string>;
  keyframeIds: Record<string, string>;
  transitionIds: Record<string, string>;
  markerIds: Record<string, string>;
}

export interface ClonedVariantCompositionGraph {
  rootCompositionId: string;
  compositions: Composition[];
  idMap: VariantCompositionGraphIdMap;
}

function defaultIdFactory(
  kind: VariantMaterializationIdKind,
  sourceId: string,
): string {
  const random = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `variant-${kind}-${sourceId}-${random}`;
}

function key(compositionId: string, sourceId: string): string {
  return `${compositionId}\u0000${sourceId}`;
}

function ownedKey(
  compositionId: string,
  ownerClipId: string,
  sourceId: string,
): string {
  return `${compositionId}\u0000${ownerClipId}\u0000${sourceId}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function collectTransitionCompositionIds(
  rootCompositionId: string,
  compositions: readonly Composition[],
): string[] {
  const byId = new Map(compositions.map((composition) => [composition.id, composition]));
  const collected = new Set<string>();
  const queue = [rootCompositionId];
  while (queue.length > 0) {
    const compositionId = queue.shift();
    if (!compositionId || collected.has(compositionId)) continue;
    const composition = byId.get(compositionId);
    if (!composition) {
      throw new Error(`Variant base references missing composition ${compositionId}.`);
    }
    collected.add(compositionId);
    for (const clip of composition.timelineData?.clips ?? []) {
      for (const transition of [clip.transitionIn, clip.transitionOut]) {
        if (transition?.compositionId) queue.push(transition.compositionId);
      }
    }
    if (composition.transitionComp?.legacyBackupCompositionId) {
      queue.push(composition.transitionComp.legacyBackupCompositionId);
    }
    for (const candidate of compositions) {
      if (
        candidate.transitionComp?.kind === 'transition-comp'
        && candidate.transitionComp.parentCompositionId === compositionId
      ) {
        queue.push(candidate.id);
      }
    }
  }
  return [...collected];
}

function makeMappedId(
  record: Record<string, string>,
  sourceKey: string,
  kind: VariantMaterializationIdKind,
  factory: VariantMaterializationIdFactory,
): string {
  const existing = record[sourceKey];
  if (existing) return existing;
  const created = factory(kind, sourceKey.replaceAll('\u0000', ':'));
  if (!created.trim()) throw new Error(`Variant ${kind} id factory returned an empty id.`);
  record[sourceKey] = created;
  return created;
}

function assertUniqueMappedIds(idMap: VariantCompositionGraphIdMap): void {
  const used = new Map<string, string>();
  for (const [kind, record] of Object.entries(idMap) as Array<
    [keyof VariantCompositionGraphIdMap, Record<string, string>]
  >) {
    for (const [source, mapped] of Object.entries(record)) {
      const previous = used.get(mapped);
      if (previous) {
        throw new Error(
          `Variant id factory returned duplicate id ${mapped} for ${previous} and ${kind}:${source}.`,
        );
      }
      used.set(mapped, `${kind}:${source}`);
    }
  }
}

function remapVertex(
  vertex: MaskVertex,
  compositionId: string,
  sourceClipId: string,
  idMap: VariantCompositionGraphIdMap,
  factory: VariantMaterializationIdFactory,
): MaskVertex {
  return {
    ...clone(vertex),
    id: makeMappedId(
      idMap.maskVertexIds,
      ownedKey(compositionId, sourceClipId, vertex.id),
      'mask-vertex',
      factory,
    ),
  };
}

function remapPathValue(
  value: MaskPathKeyframeValue | undefined,
  compositionId: string,
  sourceClipId: string,
  idMap: VariantCompositionGraphIdMap,
  factory: VariantMaterializationIdFactory,
): MaskPathKeyframeValue | undefined {
  return value
    ? {
        ...clone(value),
        vertices: value.vertices.map((vertex) => (
          remapVertex(vertex, compositionId, sourceClipId, idMap, factory)
        )),
      }
    : undefined;
}

function remapMaskProperty(
  property: Keyframe['property'],
  compositionId: string,
  sourceClipId: string,
  idMap: VariantCompositionGraphIdMap,
): Keyframe['property'] {
  const value = String(property);
  for (const [sourceKey, mappedId] of Object.entries(idMap.maskIds)) {
    const [ownerCompositionId, ownerClipId, sourceId] = sourceKey.split('\u0000');
    if (
      ownerCompositionId !== compositionId
      || ownerClipId !== sourceClipId
      || !sourceId
    ) continue;
    if (value === `mask.${sourceId}.path`) {
      return `mask.${mappedId}.path` as Keyframe['property'];
    }
  }
  return property;
}

function remapKeyframe(
  keyframe: Keyframe,
  compositionId: string,
  sourceClipId: string,
  mappedClipId: string,
  idMap: VariantCompositionGraphIdMap,
  factory: VariantMaterializationIdFactory,
): Keyframe {
  return {
    ...clone(keyframe),
    id: makeMappedId(
      idMap.keyframeIds,
      ownedKey(compositionId, sourceClipId, keyframe.id),
      'keyframe',
      factory,
    ),
    clipId: mappedClipId,
    property: remapMaskProperty(
      keyframe.property,
      compositionId,
      sourceClipId,
      idMap,
    ),
    ...(keyframe.pathValue === undefined
      ? {}
      : {
          pathValue: remapPathValue(
            keyframe.pathValue,
            compositionId,
            sourceClipId,
            idMap,
            factory,
          ),
        }),
  };
}

function remapTransition(
  transition: TimelineTransition | undefined,
  compositionId: string,
  idMap: VariantCompositionGraphIdMap,
  factory: VariantMaterializationIdFactory,
): TimelineTransition | undefined {
  if (!transition) return undefined;
  return {
    ...clone(transition),
    id: makeMappedId(
      idMap.transitionIds,
      key(compositionId, transition.id),
      'transition',
      factory,
    ),
    linkedClipId: idMap.clipIds[key(compositionId, transition.linkedClipId)]
      ?? transition.linkedClipId,
    ...(transition.compositionId === undefined
      ? {}
      : {
          compositionId: idMap.compositionIds[transition.compositionId]
            ?? transition.compositionId,
        }),
  };
}

function remapTransitionSourceMap(
  sourceMap: TransitionSourceMap | undefined,
  compositionId: string,
  sourceClipId: string,
  mappedClipId: string,
  idMap: VariantCompositionGraphIdMap,
  factory: VariantMaterializationIdFactory,
): TransitionSourceMap | undefined {
  if (!sourceMap || sourceMap.version !== 2) return sourceMap ? clone(sourceMap) : undefined;
  return {
    ...clone(sourceMap),
    parent: {
      ...clone(sourceMap.parent),
      animation: {
        ...clone(sourceMap.parent.animation),
        sourceEffectIds: sourceMap.parent.animation.sourceEffectIds.map((effectId) => (
          idMap.effectIds[ownedKey(compositionId, sourceClipId, effectId)] ?? effectId
        )),
        sourceMaskIds: sourceMap.parent.animation.sourceMaskIds.map((maskId) => (
          idMap.maskIds[ownedKey(compositionId, sourceClipId, maskId)] ?? maskId
        )),
        keyframes: sourceMap.parent.animation.keyframes.map((keyframe) => (
          remapKeyframe(
            keyframe,
            compositionId,
            sourceClipId,
            mappedClipId,
            idMap,
            factory,
          )
        )),
      },
    },
  };
}

function remapClip(
  clip: SerializableClip,
  compositionId: string,
  idMap: VariantCompositionGraphIdMap,
  factory: VariantMaterializationIdFactory,
): SerializableClip {
  const mappedClipId = idMap.clipIds[key(compositionId, clip.id)]!;
  const masks: ClipMask[] | undefined = clip.masks?.map((mask) => {
    const mappedMaskId = idMap.maskIds[
      ownedKey(compositionId, clip.id, mask.id)
    ]!;
    const vertexIdEntries = mask.vertices.map((vertex) => [
      vertex.id,
      idMap.maskVertexIds[ownedKey(compositionId, clip.id, vertex.id)]!,
    ] as const);
    const edgeFeathers = mask.edgeFeathers
      ? Object.fromEntries(Object.entries(mask.edgeFeathers).map(([edge, amount]) => {
          let mappedEdge = edge;
          for (const [sourceId, targetId] of vertexIdEntries) {
            mappedEdge = mappedEdge.replaceAll(sourceId, targetId);
          }
          return [mappedEdge, amount];
        }))
      : undefined;
    return {
      ...clone(mask),
      id: mappedMaskId,
      vertices: mask.vertices.map((vertex) => (
        remapVertex(vertex, compositionId, clip.id, idMap, factory)
      )),
      ...(edgeFeathers === undefined ? {} : { edgeFeathers }),
    };
  });

  return {
    ...clone(clip),
    id: mappedClipId,
    trackId: idMap.trackIds[key(compositionId, clip.trackId)] ?? clip.trackId,
    ...(clip.linkedClipId === undefined
      ? {}
      : {
          linkedClipId: idMap.clipIds[key(compositionId, clip.linkedClipId)]
            ?? clip.linkedClipId,
        }),
    ...(clip.linkedGroupId === undefined
      ? {}
      : {
          linkedGroupId: makeMappedId(
            idMap.linkedGroupIds,
            key(compositionId, clip.linkedGroupId),
            'linked-group',
            factory,
          ),
        }),
    effects: clip.effects.map((effect) => ({
      ...clone(effect),
      id: idMap.effectIds[ownedKey(compositionId, clip.id, effect.id)]!,
    })),
    ...(masks === undefined ? {} : { masks }),
    ...(clip.keyframes === undefined
      ? {}
      : {
          keyframes: clip.keyframes.map((keyframe) => (
            remapKeyframe(
              keyframe,
              compositionId,
              clip.id,
              mappedClipId,
              idMap,
              factory,
            )
          )),
        }),
    transitionIn: remapTransition(
      clip.transitionIn,
      compositionId,
      idMap,
      factory,
    ),
    transitionOut: remapTransition(
      clip.transitionOut,
      compositionId,
      idMap,
      factory,
    ),
    transitionSourceMap: remapTransitionSourceMap(
      clip.transitionSourceMap,
      compositionId,
      clip.id,
      mappedClipId,
      idMap,
      factory,
    ),
  };
}

function prepareLocalIds(
  composition: Composition,
  idMap: VariantCompositionGraphIdMap,
  factory: VariantMaterializationIdFactory,
): void {
  for (const track of composition.timelineData?.tracks ?? []) {
    makeMappedId(idMap.trackIds, key(composition.id, track.id), 'track', factory);
  }
  for (const clip of composition.timelineData?.clips ?? []) {
    makeMappedId(idMap.clipIds, key(composition.id, clip.id), 'clip', factory);
    if (clip.linkedGroupId) {
      makeMappedId(
        idMap.linkedGroupIds,
        key(composition.id, clip.linkedGroupId),
        'linked-group',
        factory,
      );
    }
    for (const effect of clip.effects) {
      makeMappedId(
        idMap.effectIds,
        ownedKey(composition.id, clip.id, effect.id),
        'effect',
        factory,
      );
    }
    for (const mask of clip.masks ?? []) {
      makeMappedId(
        idMap.maskIds,
        ownedKey(composition.id, clip.id, mask.id),
        'mask',
        factory,
      );
      for (const vertex of mask.vertices) {
        makeMappedId(
          idMap.maskVertexIds,
          ownedKey(composition.id, clip.id, vertex.id),
          'mask-vertex',
          factory,
        );
      }
    }
    for (const keyframe of clip.keyframes ?? []) {
      makeMappedId(
        idMap.keyframeIds,
        ownedKey(composition.id, clip.id, keyframe.id),
        'keyframe',
        factory,
      );
    }
    for (const transition of [clip.transitionIn, clip.transitionOut]) {
      if (transition) {
        makeMappedId(
          idMap.transitionIds,
          key(composition.id, transition.id),
          'transition',
          factory,
        );
      }
    }
  }
  for (const marker of composition.timelineData?.markers ?? []) {
    makeMappedId(idMap.markerIds, key(composition.id, marker.id), 'marker', factory);
  }
}

function remapTrack(
  track: TimelineTrack,
  compositionId: string,
  idMap: VariantCompositionGraphIdMap,
): TimelineTrack {
  return {
    ...clone(track),
    id: idMap.trackIds[key(compositionId, track.id)]!,
    ...(track.parentTrackId === undefined
      ? {}
      : {
          parentTrackId: idMap.trackIds[key(compositionId, track.parentTrackId)]
            ?? track.parentTrackId,
        }),
  };
}

function remapMarker(
  marker: SerializableMarker,
  compositionId: string,
  idMap: VariantCompositionGraphIdMap,
): SerializableMarker {
  return {
    ...clone(marker),
    id: idMap.markerIds[key(compositionId, marker.id)]!,
  };
}

function remapTransitionCompositionLink(
  composition: Composition,
  idMap: VariantCompositionGraphIdMap,
): Composition['transitionComp'] {
  const link = composition.transitionComp;
  if (!link) return undefined;
  const parentId = link.parentCompositionId;
  return {
    ...clone(link),
    parentCompositionId: idMap.compositionIds[parentId] ?? parentId,
    parentTransitionId: idMap.transitionIds[key(parentId, link.parentTransitionId)]
      ?? link.parentTransitionId,
    parentOutgoingClipId: idMap.clipIds[key(parentId, link.parentOutgoingClipId)]
      ?? link.parentOutgoingClipId,
    parentIncomingClipId: idMap.clipIds[key(parentId, link.parentIncomingClipId)]
      ?? link.parentIncomingClipId,
    linkedOutgoingClipId: idMap.clipIds[key(composition.id, link.linkedOutgoingClipId)]
      ?? link.linkedOutgoingClipId,
    linkedIncomingClipId: idMap.clipIds[key(composition.id, link.linkedIncomingClipId)]
      ?? link.linkedIncomingClipId,
    innerTransitionId: idMap.transitionIds[key(composition.id, link.innerTransitionId)]
      ?? link.innerTransitionId,
    ...(link.legacyBackupCompositionId === undefined
      ? {}
      : {
          legacyBackupCompositionId:
            idMap.compositionIds[link.legacyBackupCompositionId]
              ?? link.legacyBackupCompositionId,
        }),
  };
}

export function cloneCompositionGraphForVariant(
  compositions: readonly Composition[],
  rootCompositionId: string,
  factory: VariantMaterializationIdFactory = defaultIdFactory,
): ClonedVariantCompositionGraph {
  const graphIds = collectTransitionCompositionIds(rootCompositionId, compositions);
  const graph = graphIds.map((compositionId) => {
    const composition = compositions.find((candidate) => candidate.id === compositionId);
    if (!composition) throw new Error(`Missing composition ${compositionId}.`);
    return composition;
  });
  const idMap: VariantCompositionGraphIdMap = {
    compositionIds: {},
    trackIds: {},
    clipIds: {},
    linkedGroupIds: {},
    effectIds: {},
    maskIds: {},
    maskVertexIds: {},
    keyframeIds: {},
    transitionIds: {},
    markerIds: {},
  };
  for (const composition of graph) {
    idMap.compositionIds[composition.id] = makeMappedId(
      idMap.compositionIds,
      composition.id,
      'composition',
      factory,
    );
  }
  for (const composition of graph) prepareLocalIds(composition, idMap, factory);
  assertUniqueMappedIds(idMap);

  const cloned = graph.map((composition): Composition => {
    const timelineData = composition.timelineData
      ? {
          ...clone(composition.timelineData),
          tracks: composition.timelineData.tracks.map((track) => (
            remapTrack(track, composition.id, idMap)
          )),
          clips: composition.timelineData.clips.map((clip) => (
            remapClip(clip, composition.id, idMap, factory)
          )),
          ...(composition.timelineData.markers === undefined
            ? {}
            : {
                markers: composition.timelineData.markers.map((marker) => (
                  remapMarker(marker, composition.id, idMap)
                )),
              }),
        }
      : undefined;
    return {
      ...clone(composition),
      id: idMap.compositionIds[composition.id]!,
      name: composition.id === rootCompositionId
        ? composition.name
        : `${composition.name} · Variant transition`,
      createdAt: Date.now(),
      ...(timelineData === undefined ? {} : { timelineData }),
      transitionComp: remapTransitionCompositionLink(composition, idMap),
    };
  });

  return {
    rootCompositionId: idMap.compositionIds[rootCompositionId]!,
    compositions: cloned,
    idMap,
  };
}
