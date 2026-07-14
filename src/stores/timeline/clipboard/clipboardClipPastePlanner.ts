import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import { remapClipNodeGraphEffectIds } from '../../../services/nodeGraph';
import type { ClipboardClipData, Keyframe } from '../types';
import {
  clipRequiresAsyncMediaLoad,
  createPastedClipSource as createPastedClipSourceImpl,
} from './clipboardPastedClipSource';

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

// createTimelineMathSceneCanvasRuntime lives in clipboardPastedClipSource.
function createPastedClipSource(
  clipData: ClipboardClipData,
  text3DProperties: TimelineClip['text3DProperties'],
): TimelineClip['source'] {
  return createPastedClipSourceImpl(clipData, text3DProperties);
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
