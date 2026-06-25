import type { TimelineClip, TimelineTrack } from '../../../types';
import { isVectorAnimationSourceType } from '../../../types/vectorAnimation';
import { DEFAULT_SCENE_CAMERA_SETTINGS } from '../../mediaStore/types';
import { DEFAULT_SPLAT_EFFECTOR_SETTINGS } from '../../../types/splatEffector';
import { createTimelineMathSceneCanvasRuntime, createTimelineTransitionOverlayCanvasRuntime } from '../../../services/timeline/timelineGeneratedCanvasRuntime';
import { remapClipNodeGraphEffectIds } from '../../../services/nodeGraph';
import type { ClipboardClipData, Keyframe } from '../types';

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
      return { ...e, id: nextEffectId, params: { ...e.params } };
    });
    const text3DProperties = clipData.text3DProperties ? { ...clipData.text3DProperties } : undefined;
    const requiresAsyncMediaLoad = clipRequiresAsyncMediaLoad(clipData);

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
      colorCorrection: clipData.colorCorrection ? structuredClone(clipData.colorCorrection) : undefined,
      nodeGraph: remapClipNodeGraphEffectIds(clipData.nodeGraph, effectIdMap),
      masks: clipData.masks?.map(m => ({
        ...m,
        id: `mask-${timestamp}-${createSuffix()}`,
        vertices: m.vertices.map(v => ({ ...v, id: `vertex-${timestamp}-${createSuffix()}` })),
      })),
      linkedClipId: clipData.linkedClipId ? idMapping.get(clipData.linkedClipId) : undefined,
      reversed: clipData.reversed,
      speed: clipData.speed,
      preservesPitch: clipData.preservesPitch,
      textProperties: clipData.textProperties ? { ...clipData.textProperties } : undefined,
      text3DProperties,
      solidColor: clipData.solidColor,
      transitionOverlay: clipData.transitionOverlay ? structuredClone(clipData.transitionOverlay) : undefined,
      mathScene: clipData.mathScene ? structuredClone(clipData.mathScene) : undefined,
      motion: clipData.motion ? structuredClone(clipData.motion) : undefined,
      thumbnails: clipData.thumbnails ? [...clipData.thumbnails] : undefined,
      waveform: clipData.waveform ? [...clipData.waveform] : undefined,
      waveformChannels: clipData.waveformChannels?.map(channel => [...channel]),
      audioState: createPastedClipAudioState(clipData),
      isComposition: clipData.isComposition,
      compositionId: clipData.compositionId,
      is3D: clipData.is3D,
      wireframe: clipData.wireframe,
      meshType: clipData.meshType,
      isLoading: clipData.isComposition || clipData.sourceType === 'text' || clipData.sourceType === 'solid' || requiresAsyncMediaLoad,
      needsReload: requiresAsyncMediaLoad,
    });

    if (clipData.keyframes && clipData.keyframes.length > 0) {
      newKeyframes.set(newId, clipData.keyframes.map(kf => ({
        ...kf,
        id: `kf_${timestamp}_${createSuffix()}`,
        clipId: newId,
      })));
    }
  }

  return { idMapping, newClips, newKeyframes };
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

function clipRequiresAsyncMediaLoad(clipData: ClipboardClipData): boolean {
  return !clipData.isComposition &&
    clipData.sourceType !== 'text' &&
    clipData.sourceType !== 'solid' &&
    clipData.sourceType !== 'math-scene' &&
    clipData.sourceType !== 'transition-overlay' &&
    !isPrimitiveMeshClip(clipData) &&
    clipData.sourceType !== 'camera' &&
    clipData.sourceType !== 'splat-effector' &&
    !isMotionClip(clipData);
}

function isPrimitiveMeshClip(clipData: ClipboardClipData): boolean {
  return clipData.sourceType === 'model' && !!clipData.meshType;
}

function isMotionClip(clipData: ClipboardClipData): boolean {
  return clipData.sourceType === 'motion-shape' ||
    clipData.sourceType === 'motion-null' ||
    clipData.sourceType === 'motion-adjustment';
}

function createPastedClipSource(
  clipData: ClipboardClipData,
  text3DProperties: TimelineClip['text3DProperties'],
): TimelineClip['source'] {
  if (isPrimitiveMeshClip(clipData)) {
    return {
      type: 'model',
      meshType: clipData.meshType,
      mediaFileId: clipData.mediaFileId,
      naturalDuration: clipData.naturalDuration ?? Number.MAX_SAFE_INTEGER,
      threeDEffectorsEnabled: clipData.threeDEffectorsEnabled ?? true,
      ...(text3DProperties ? { text3DProperties } : {}),
    };
  }
  if (clipData.sourceType === 'camera') {
    return {
      type: 'camera',
      mediaFileId: clipData.mediaFileId,
      naturalDuration: clipData.naturalDuration ?? Number.MAX_SAFE_INTEGER,
      cameraSettings: clipData.cameraSettings ? { ...clipData.cameraSettings } : { ...DEFAULT_SCENE_CAMERA_SETTINGS },
    };
  }
  if (clipData.sourceType === 'splat-effector') {
    return {
      type: 'splat-effector',
      mediaFileId: clipData.mediaFileId,
      naturalDuration: clipData.naturalDuration ?? Number.MAX_SAFE_INTEGER,
      splatEffectorSettings: clipData.splatEffectorSettings
        ? { ...clipData.splatEffectorSettings }
        : { ...DEFAULT_SPLAT_EFFECTOR_SETTINGS },
    };
  }
  if (clipData.sourceType === 'solid') {
    return { type: 'solid', mediaFileId: clipData.mediaFileId, naturalDuration: clipData.duration };
  }
  if (clipData.sourceType === 'text') {
    return { type: 'text', mediaFileId: clipData.mediaFileId, naturalDuration: clipData.naturalDuration ?? clipData.duration };
  }
  if (clipData.sourceType === 'math-scene' && clipData.mathScene) {
    return {
      type: 'math-scene',
      mediaFileId: clipData.mediaFileId,
      naturalDuration: clipData.naturalDuration ?? clipData.duration,
      textCanvas: createTimelineMathSceneCanvasRuntime({ mathScene: clipData.mathScene, duration: clipData.duration }),
    };
  }
  if (clipData.sourceType === 'transition-overlay' && clipData.transitionOverlay) {
    return {
      type: 'transition-overlay',
      mediaFileId: clipData.mediaFileId,
      naturalDuration: clipData.naturalDuration ?? clipData.duration,
      textCanvas: createTimelineTransitionOverlayCanvasRuntime({ overlay: clipData.transitionOverlay }),
      transitionOverlay: structuredClone(clipData.transitionOverlay),
    };
  }
  if (isMotionClip(clipData) && clipData.motion) {
    return { type: clipData.sourceType, mediaFileId: clipData.mediaFileId, naturalDuration: clipData.naturalDuration ?? clipData.duration };
  }
  if (isVectorAnimationSourceType(clipData.sourceType) && clipData.mediaFileId) {
    return {
      type: clipData.sourceType,
      mediaFileId: clipData.mediaFileId,
      naturalDuration: clipData.naturalDuration ?? clipData.duration,
      vectorAnimationSettings: clipData.vectorAnimationSettings,
    };
  }
  return clipData.mediaFileId
    ? {
        type: clipData.sourceType,
        mediaFileId: clipData.mediaFileId,
        naturalDuration: clipData.naturalDuration,
        threeDEffectorsEnabled: clipData.threeDEffectorsEnabled ?? true,
      }
    : null;
}

function createPastedClipAudioState(clipData: ClipboardClipData): TimelineClip['audioState'] {
  if (!clipData.audioAnalysisRefs) return undefined;
  return {
    sourceAnalysisRefs: clipData.audioAnalysisRefs.sourceAnalysisRefs
      ? structuredClone(clipData.audioAnalysisRefs.sourceAnalysisRefs)
      : undefined,
    processedAnalysisRefs: clipData.audioAnalysisRefs.processedAnalysisRefs
      ? structuredClone(clipData.audioAnalysisRefs.processedAnalysisRefs)
      : undefined,
  };
}
