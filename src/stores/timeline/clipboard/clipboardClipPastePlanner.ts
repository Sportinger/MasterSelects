import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import { remapClipNodeGraphEffectIds } from '../../../services/nodeGraph';
import { remapKeyframeNodeProperties } from '../../../services/nodeGraph/keyframeNodeRemapping';
import { remapFlockKeyframeProperty } from '../editOperations/flockClipKeyframes';
import { parseMaskProperty, createMaskEdgeFeatherProperty } from '../../../types/animationProperties';
import type { ClipboardClipData, Keyframe } from '../types';
import { cloneStoryboardClipProperties } from '../../../services/storyboard/core';
import {
  clipRequiresAsyncMediaLoad,
  createPastedClipSource as createPastedClipSourceImpl,
} from './clipboardPastedClipSource';
import { normalizeMotionLayerDefinition } from '../../../services/motionDesign/contracts/replicatorTimelineAdapter';
import { applyTimelineMotionWorldTransformAtTime } from '../../../services/motionDesign/contracts/timelineStructureAdapter';
import {
  createMotionParentGraphSnapshot,
  planMotionParentRemap,
} from '../../../services/motionDesign/structure/parentGraphPlanner';
import { clonePastedTimelineTrackingMetadata } from '../trackingMetadataClone';
import { createPastedFlockCopy, remapPastedClipKeyframes } from './clipboardFlockPaste';
import { createPastedClipAudioState } from './clipboardAudioState';

export interface PastedClipboardClipsPlan {
  idMapping: Map<string, string>;
  newClips: TimelineClip[];
  newKeyframes: Map<string, Keyframe[]>;
}
export interface CreatePastedClipboardClipsPlanInput {
  clipboardData: readonly ClipboardClipData[];
  playheadPosition: number;
  tracks: readonly TimelineTrack[];
  clipKeyframes: ReadonlyMap<string, Keyframe[]>;
  targetTrackIdByType?: Partial<Record<TimelineTrack['type'], string>>;
  timestamp: number;
  createSuffix: () => string;
  onMissingTrack?: (clipData: ClipboardClipData) => void;
  destinationCompositionId?: string;
}
export function createPastedClipboardClipsPlan(
  input: CreatePastedClipboardClipsPlanInput,
): PastedClipboardClipsPlan {
  const { clipboardData, playheadPosition, tracks, clipKeyframes, targetTrackIdByType, timestamp, createSuffix } = input;
  const idMapping = new Map<string, string>();
  clipboardData.forEach(clipData => {
    idMapping.set(clipData.id, `clip-${timestamp}-${createSuffix()}`);
  });

  const earliestStartTime = Math.min(...clipboardData.map(c => c.startTime));
  const timeOffset = playheadPosition - earliestStartTime;
  const newClips: TimelineClip[] = [];
  const newKeyframes = new Map<string, Keyframe[]>(clipKeyframes);
  const pastedSourceIds = new Set<string>();

  for (const clipData of clipboardData) {
    const targetTrackId = resolveTargetTrackId(clipData, tracks, targetTrackIdByType);
    if (!targetTrackId) {
      input.onMissingTrack?.(clipData);
      continue;
    }

    const newId = idMapping.get(clipData.id)!;
    const effectIdMap = new Map<string, string>();
    const effects = clipData.effects.map(e => {
      const nextEffectId = `effect-${timestamp}-${createSuffix()}`;
      effectIdMap.set(e.id, nextEffectId);
      return { ...e, id: nextEffectId, params: structuredClone(e.params) };
    });
    const text3DProperties = clipData.text3DProperties ? { ...clipData.text3DProperties } : undefined;
    const requiresAsyncMediaLoad = clipRequiresAsyncMediaLoad(clipData);
    const flockCopy = createPastedFlockCopy(clipData);
    const audioState = createPastedClipAudioState(clipData, effectIdMap, () => `audio-${timestamp}-${createSuffix()}`, timeOffset);
    const maskIdMap = new Map<string, string>();
    const masks = clipData.masks?.map(mask => {
      const id = `mask-${timestamp}-${createSuffix()}`;
      maskIdMap.set(mask.id, id);
      return { ...mask, id, vertices: mask.vertices.map(vertex => {
        const vertexId = `vertex-${timestamp}-${createSuffix()}`;
        maskIdMap.set(vertex.id, vertexId);
        return { ...vertex, id: vertexId };
      }) };
    });
    const remapProperty = (property: string) => {
      const mask = parseMaskProperty(property);
      if (mask) {
        const id = maskIdMap.get(mask.maskId) ?? mask.maskId;
        property = mask.property === 'edgeFeather'
          ? createMaskEdgeFeatherProperty(id, mask.edgeId.split('->').map(vertex => maskIdMap.get(vertex) ?? vertex).join('->'))
          : `mask.${id}.${mask.property}`;
      }
      return flockCopy ? remapFlockKeyframeProperty(property as Keyframe['property'], flockCopy.nodeIdMap) : property;
    };

    newClips.push({
      id: newId,
      trackId: targetTrackId,
      name: clipData.name,
      file: new File([], clipData.name),
      mediaFileId: clipData.mediaFileId,
      signalAssetId: clipData.signalAssetId,
      signalRefId: clipData.signalRefId,
      signalRenderAdapterId: clipData.signalRenderAdapterId,
      startTime: Math.max(0, clipData.startTime + timeOffset),
      duration: clipData.duration,
      inPoint: clipData.inPoint,
      outPoint: clipData.outPoint,
      source: createPastedClipSource(clipData, text3DProperties),
      transform: {
        ...clipData.transform,
        position: { ...clipData.transform.position },
        scale: { ...clipData.transform.scale },
        rotation: { ...clipData.transform.rotation },
      },
      effects,
      ...clonePastedTimelineTrackingMetadata(clipData, idMapping),
      colorCorrection: clipData.colorCorrection ? structuredClone(clipData.colorCorrection) : undefined,
      nodeGraph: remapKeyframeNodeProperties(remapClipNodeGraphEffectIds(clipData.nodeGraph, effectIdMap), remapProperty),
      masks,
      linkedClipId: clipData.linkedClipId ? idMapping.get(clipData.linkedClipId) : undefined,
      parentClipId: undefined,
      reversed: clipData.reversed,
      speed: clipData.speed,
      preservesPitch: clipData.preservesPitch, followsLinkedVideoSpeed: clipData.followsLinkedVideoSpeed,
      freeRun: clipData.freeRun,
      textProperties: clipData.textProperties ? { ...clipData.textProperties } : undefined,
      captionProperties: clipData.captionProperties
        ? {
            ...structuredClone(clipData.captionProperties),
            sourceClipId: clipData.captionProperties.sourceClipId
              ? idMapping.get(clipData.captionProperties.sourceClipId)
                ?? clipData.captionProperties.sourceClipId
              : null,
        }
        : undefined,
      captionLayerBinding: clipData.captionLayerBinding
        ? {
            ...structuredClone(clipData.captionLayerBinding),
            inputClipId: idMapping.get(clipData.captionLayerBinding.inputClipId)
              ?? clipData.captionLayerBinding.inputClipId,
            textClipId: clipData.captionLayerBinding.textClipId
              ? idMapping.get(clipData.captionLayerBinding.textClipId)
                ?? clipData.captionLayerBinding.textClipId
              : undefined,
          }
        : undefined,
      text3DProperties,
      solidColor: clipData.solidColor,
      // Copy/paste gives the clip a new id but deliberately retains sceneId.
      storyboardProperties: cloneStoryboardClipProperties(clipData.storyboardProperties),
      transitionOverlay: clipData.transitionOverlay ? structuredClone(clipData.transitionOverlay) : undefined,
      mathScene: clipData.mathScene ? structuredClone(clipData.mathScene) : undefined,
      flock: flockCopy?.definition,
      motion: clipData.motion ? normalizeMotionLayerDefinition(clipData.motion) : undefined,
      thumbnails: clipData.thumbnails ? [...clipData.thumbnails] : undefined,
      waveform: clipData.waveform ? [...clipData.waveform] : undefined,
      waveformChannels: clipData.waveformChannels?.map(channel => [...channel]),
      audioState,
      analysis: clipData.analysis,
      analysisStatus: clipData.analysisStatus,
      analysisProgress: clipData.analysisProgress,
      faceAnalysisStatus: clipData.faceAnalysisStatus,
      faceAnalysisProgress: clipData.faceAnalysisProgress,
      faceAnalysisMessage: clipData.faceAnalysisMessage,
      isComposition: clipData.isComposition,
      compositionId: clipData.compositionId,
      is3D: clipData.is3D,
      wireframe: clipData.wireframe,
      meshType: clipData.meshType,
      isLoading: clipData.isComposition || clipData.sourceType === 'text' || clipData.sourceType === 'solid' || requiresAsyncMediaLoad,
      needsReload: requiresAsyncMediaLoad,
    });
    pastedSourceIds.add(clipData.id);

    const pastedKeyframes = remapPastedClipKeyframes(clipData.keyframes, newId, () => `kf_${timestamp}_${createSuffix()}`, flockCopy, effectIdMap);
    if (pastedKeyframes) newKeyframes.set(newId, pastedKeyframes.map(key => ({ ...key, property: remapProperty(key.property) as Keyframe['property'] })));
  }

  applyClipboardMotionParentRemap({
    clipboardData,
    idMapping,
    pastedSourceIds,
    newClips,
    newKeyframes,
    playheadPosition,
    destinationCompositionId: input.destinationCompositionId ?? 'timeline:clipboard-destination',
  });

  return { idMapping, newClips, newKeyframes };
}

interface ApplyClipboardMotionParentRemapInput {
  readonly clipboardData: readonly ClipboardClipData[];
  readonly idMapping: ReadonlyMap<string, string>;
  readonly pastedSourceIds: ReadonlySet<string>;
  readonly newClips: TimelineClip[];
  readonly newKeyframes: Map<string, Keyframe[]>;
  readonly playheadPosition: number;
  readonly destinationCompositionId: string;
}

function applyClipboardMotionParentRemap(
  input: ApplyClipboardMotionParentRemapInput,
): void {
  if (input.pastedSourceIds.size === 0) return;
  const clipboardById = new Map(input.clipboardData.map((clip) => [clip.id, clip]));
  const sourceNodes = input.clipboardData.map((clip) => ({
    clipId: clip.id,
    compositionId: 'timeline:clipboard-source',
    space: clip.is3D ? '3d' as const : '2d' as const,
    ...(clip.parentClipId ? { parentClipId: clip.parentClipId } : {}),
  }));
  const sourceNodeIds = new Set(sourceNodes.map((node) => node.clipId));
  for (const clip of input.clipboardData) {
    if (!clip.parentClipId || sourceNodeIds.has(clip.parentClipId)) continue;
    sourceNodeIds.add(clip.parentClipId);
    sourceNodes.push({
      clipId: clip.parentClipId,
      compositionId: 'timeline:clipboard-source',
      space: '2d',
    });
  }
  const targetClipIdsBySourceId = Object.fromEntries(
    [...input.pastedSourceIds].map((sourceClipId) => [
      sourceClipId,
      input.idMapping.get(sourceClipId)!,
    ]),
  );
  const remap = planMotionParentRemap({
    sourceGraph: createMotionParentGraphSnapshot(sourceNodes),
    copiedClipIds: [...input.pastedSourceIds],
    targetClipIdsBySourceId,
    destinationCompositionId: input.destinationCompositionId,
  });
  const assignmentsByTargetId = remap.ok
    ? new Map(remap.plan.assignments.map((assignment) => [assignment.targetClipId, assignment]))
    : new Map<string, { readonly parentClipId?: string }>();

  for (let index = 0; index < input.newClips.length; index += 1) {
    const clip = input.newClips[index];
    const sourceId = [...input.pastedSourceIds].find(
      (candidate) => input.idMapping.get(candidate) === clip.id,
    );
    if (!sourceId) continue;
    const source = clipboardById.get(sourceId)!;
    const assignment = assignmentsByTargetId.get(clip.id);
    if (assignment?.parentClipId) {
      input.newClips[index] = { ...clip, parentClipId: assignment.parentClipId };
      continue;
    }
    if (!source.parentClipId || !source.worldTransformAtCopyTime) continue;

    const preserved = applyTimelineMotionWorldTransformAtTime({
      clip,
      keyframes: input.newKeyframes.get(clip.id) ?? [],
      timelineTime: input.playheadPosition,
      worldTransform: source.worldTransformAtCopyTime,
    });
    input.newClips[index] = preserved.clip;
    input.newKeyframes.set(clip.id, preserved.keyframes);
  }
}

function resolveTargetTrackId(
  clipData: ClipboardClipData,
  tracks: readonly TimelineTrack[],
  targetTrackIdByType: Partial<Record<TimelineTrack['type'], string>> | undefined,
): string | null {
  const originalTrack = tracks.find(t => t.id === clipData.trackId);
  const requestedTargetTrackId = targetTrackIdByType?.[clipData.trackType];
  const targetedTrack = requestedTargetTrackId
    ? tracks.find(t => t.id === requestedTargetTrackId)
    : undefined;
  const usableTargetedTrack = isUsablePasteTargetTrack(targetedTrack) ? targetedTrack : undefined;
  if (usableTargetedTrack) return usableTargetedTrack.id;
  if (isUsablePasteTargetTrack(originalTrack)) return clipData.trackId;
  return tracks.find(t => t.type === clipData.trackType && isUsablePasteTargetTrack(t))?.id ?? null;
}

function isUsablePasteTargetTrack(track: TimelineTrack | undefined): track is TimelineTrack {
  return !!track && track.locked !== true && (track.type !== 'video' || track.visible !== false);
}

// createTimelineMathSceneCanvasRuntime lives in clipboardPastedClipSource.
function createPastedClipSource(
  clipData: ClipboardClipData,
  text3DProperties: TimelineClip['text3DProperties'],
): TimelineClip['source'] {
  return createPastedClipSourceImpl(clipData, text3DProperties);
}
