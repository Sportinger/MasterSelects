import type { TimelineClip } from '../../../stores/timeline/types';
import type { Composition, MediaFile } from '../../../stores/mediaStore/types';
import { DEFAULT_TRANSFORM } from '../../../stores/timeline/constants';
import {
  DEFAULT_TRANSITION_PLACEMENT,
  findActiveTransitionPlanForTrack,
  type ActiveTransitionPlan,
} from '../../../stores/timeline/editOperations/transitionPlanner';
import type { Layer } from '../../../types/layers';
import type { TimelineClipSource } from '../../../types';
import type { ParallelDecodeManager } from '../../ParallelDecodeManager';
import {
  getTransitionCompositionTime,
  hydrateTransitionCompositionTimeline,
  type TransitionCompositionSourceResolver,
} from '../../../services/layerBuilder/layerBuilderTransitionComposition';
import { createTransitionNestedCompositionLayer } from '../../../services/layerBuilder/transitionNestedCompositionLayer';
import type { ExportClipStateLike } from './contracts';
import { buildNestedBaseLayer, getNestedClipKeyframes } from './baseLayers';
import {
  buildGaussianSplatSource,
  buildLightSource,
  buildModelSource,
  buildMotionSource,
  getCompositionSize,
  getExportImageElement,
  getExportVideoElement,
} from './sourceLookup';
import { buildTextLikeLayer, isTextLikeClipSource } from './textLayers';
import { buildNestedVideoLayer } from './videoLayers';

const MAX_EXPORT_NESTING_DEPTH = 4;

export interface ExportNestedMediaState {
  mediaFiles: MediaFile[];
  mediaCompositions: Composition[];
}

function createPlaceholderFile(name: string): File {
  return typeof File !== 'undefined'
    ? new File([], name || 'transition-comp')
    : ({} as File);
}

function matchesLinkedClipId(clipId: string, baseId: string): boolean {
  return clipId === baseId || clipId.startsWith(`${baseId}:`);
}

function getNestedClipSourceTime(nestedClip: TimelineClip, nestedClipLocalTime: number): number {
  const sourceOverride = nestedClip.transitionSourceTimeOverride;
  if (Number.isFinite(sourceOverride)) return sourceOverride!;
  if (nestedClip.transitionSourceHold) return nestedClip.inPoint ?? 0;
  return nestedClip.reversed
    ? (nestedClip.outPoint ?? nestedClip.duration) - nestedClipLocalTime
    : nestedClipLocalTime + (nestedClip.inPoint ?? 0);
}

function cloneTransform() {
  return structuredClone(DEFAULT_TRANSFORM);
}

function createExportTransitionSourceResolver(
  clipStates: Map<string, ExportClipStateLike>,
): TransitionCompositionSourceResolver {
  return (clip, runtimeClip): TimelineClipSource | null | undefined => {
    if (!runtimeClip?.source) return undefined;

    if (runtimeClip.source.type === 'video') {
      const clipState = clipStates.get(runtimeClip.id);
      const videoElement = getExportVideoElement(runtimeClip, clipStates);
      return {
        ...runtimeClip.source,
        type: 'video',
        mediaFileId: clip.mediaFileId || runtimeClip.source.mediaFileId || runtimeClip.mediaFileId,
        naturalDuration: clip.naturalDuration ?? runtimeClip.source.naturalDuration ?? runtimeClip.duration,
        ...(videoElement ? { videoElement } : {}),
        webCodecsPlayer: clipState?.webCodecsPlayer ?? runtimeClip.source.webCodecsPlayer,
      };
    }

    if (runtimeClip.source.type === 'image') {
      const imageElement = getExportImageElement(runtimeClip, clipStates);
      return {
        ...runtimeClip.source,
        type: 'image',
        mediaFileId: clip.mediaFileId || runtimeClip.source.mediaFileId || runtimeClip.mediaFileId,
        naturalDuration: clip.naturalDuration ?? runtimeClip.source.naturalDuration ?? runtimeClip.duration,
        ...(imageElement ? { imageElement } : {}),
      };
    }

    return undefined;
  };
}

function tagLinkedExportSourceClipIds(
  clips: TimelineClip[],
  activeTransition: ActiveTransitionPlan,
  compositionId: string,
  mediaCompositions: Composition[],
): void {
  const composition = mediaCompositions.find(candidate => candidate.id === compositionId);
  const link = composition?.transitionComp;
  if (link?.kind !== 'transition-comp') return;

  for (const clip of clips as Array<TimelineClip & { exportSourceClipId?: string }>) {
    if (matchesLinkedClipId(clip.id, link.linkedOutgoingClipId)) {
      clip.exportSourceClipId = activeTransition.outgoingClip.id;
    } else if (matchesLinkedClipId(clip.id, link.linkedIncomingClipId)) {
      clip.exportSourceClipId = activeTransition.incomingClip.id;
    }
  }
}

export function buildTransitionCompositionLayerForExport(params: {
  activeTransition: ActiveTransitionPlan;
  layerIndex: number;
  parentCompositionId: string;
  parentTime: number;
  layerIdPrefix: string;
  clipStates: Map<string, ExportClipStateLike>;
  parallelDecoder: ParallelDecodeManager | null;
  useParallelDecode: boolean;
  mediaFiles: MediaFile[];
  mediaCompositions: Composition[];
  depth?: number;
}): Layer | null {
  const {
    activeTransition,
    layerIndex,
    parentCompositionId,
    parentTime,
    layerIdPrefix,
    clipStates,
    parallelDecoder,
    useParallelDecode,
    mediaFiles,
    mediaCompositions,
    depth = 0,
  } = params;
  const transition = activeTransition.outgoingClip.transitionOut;
  const compositionId = transition?.compositionId;
  if (!transition || !compositionId || compositionId === parentCompositionId) return null;

  const composition = mediaCompositions.find(candidate => candidate.id === compositionId);
  if (!composition?.timelineData || composition.transitionComp?.kind !== 'transition-comp') return null;

  const mediaFileById = new Map(mediaFiles.map(file => [file.id, file]));
  const compositionTime = getTransitionCompositionTime(activeTransition, composition, parentTime);
  const nestedTimeline = hydrateTransitionCompositionTimeline({
    composition,
    activeTransition,
    mediaFileById,
    resolveSource: createExportTransitionSourceResolver(clipStates),
  });
  tagLinkedExportSourceClipIds(nestedTimeline.clips, activeTransition, composition.id, mediaCompositions);

  const duration = Math.max(0.0001, composition.timelineData.duration ?? composition.duration);
  const syntheticClip: TimelineClip = {
    id: `transition-comp-export:${composition.id}`,
    trackId: activeTransition.outgoingClip.trackId,
    name: composition.name,
    file: createPlaceholderFile(composition.name),
    startTime: 0,
    duration,
    inPoint: 0,
    outPoint: duration,
    source: null,
    transform: cloneTransform(),
    effects: [],
    isComposition: true,
    compositionId: composition.id,
    nestedClips: nestedTimeline.clips,
    nestedTracks: nestedTimeline.tracks,
    isLoading: false,
  };
  const nestedLayers = buildNestedLayersForExport(
    syntheticClip,
    compositionTime,
    parentTime,
    clipStates,
    parallelDecoder,
    useParallelDecode,
    mediaFiles,
    mediaCompositions,
    depth + 1,
  );

  return createTransitionNestedCompositionLayer({
    transition,
    composition,
    compositionTime,
    nestedLayers,
    layerIndex,
    layerIdPrefix,
    sceneClips: nestedTimeline.clips,
    sceneTracks: nestedTimeline.tracks,
  });
}

export function buildNestedLayersForExport(
  clip: TimelineClip,
  nestedTime: number,
  mainTimelineTime: number,
  clipStates: Map<string, ExportClipStateLike>,
  parallelDecoder: ParallelDecodeManager | null,
  useParallelDecode: boolean,
  mediaFiles: MediaFile[],
  mediaCompositions: Composition[],
  depth: number = 0,
): Layer[] {
  if (!clip.nestedClips || !clip.nestedTracks || depth >= MAX_EXPORT_NESTING_DEPTH) return [];

  const nestedVideoTracks = clip.nestedTracks.filter(t => t.type === 'video');
  const nestedAnyVideoSolo = nestedVideoTracks.some(t => t.solo);
  const layers: Layer[] = [];

  for (let i = 0; i < nestedVideoTracks.length; i++) {
    const nestedTrack = nestedVideoTracks[i];
    if (nestedTrack.visible === false) continue;
    if (nestedAnyVideoSolo && !nestedTrack.solo) continue;

    const activeTransition = findActiveTransitionPlanForTrack({
      clips: clip.nestedClips,
      trackId: nestedTrack.id,
      time: nestedTime,
      placement: DEFAULT_TRANSITION_PLACEMENT,
      edgePolicy: 'hold',
      getMediaDuration: (mediaFileId) =>
        mediaFiles.find((file) => file.id === mediaFileId)?.duration,
    });
    if (activeTransition) {
      const transitionLayer = buildTransitionCompositionLayerForExport({
        activeTransition,
        layerIndex: i,
        parentCompositionId: clip.compositionId || clip.id,
        parentTime: nestedTime,
        layerIdPrefix: clip.compositionId || clip.id,
        clipStates,
        parallelDecoder,
        useParallelDecode,
        mediaFiles,
        mediaCompositions,
        depth,
      });
      if (transitionLayer) {
        layers.push(transitionLayer);
      }
      continue;
    }

    const nestedClip = clip.nestedClips.find(
      nc =>
        nc.trackId === nestedTrack.id &&
        nestedTime >= nc.startTime &&
        nestedTime < nc.startTime + nc.duration
    );

    if (!nestedClip) continue;

    const nestedClipLocalTime = nestedTime - nestedClip.startTime;
    const nestedLayer = buildNestedLayerForExport(
      nestedClip,
      nestedClipLocalTime,
      mainTimelineTime,
      clipStates,
      parallelDecoder,
      useParallelDecode,
      mediaFiles,
      mediaCompositions,
      depth,
    );
    if (nestedLayer) {
      layers.push(nestedLayer);
    }
  }

  return layers;
}

function buildNestedLayerForExport(
  nestedClip: TimelineClip,
  nestedClipLocalTime: number,
  mainTimelineTime: number,
  clipStates: Map<string, ExportClipStateLike>,
  parallelDecoder: ParallelDecodeManager | null,
  useParallelDecode: boolean,
  mediaFiles: MediaFile[],
  mediaCompositions: Composition[],
  depth: number,
): Layer | null {
  const baseLayer = buildNestedBaseLayer(nestedClip, nestedClipLocalTime);

  if (nestedClip.isComposition && nestedClip.nestedClips && nestedClip.nestedTracks) {
    const subCompTime = nestedClipLocalTime + (nestedClip.inPoint || 0);
    const subLayers = buildNestedLayersForExport(
      nestedClip,
      subCompTime,
      mainTimelineTime,
      clipStates,
      parallelDecoder,
      useParallelDecode,
      mediaFiles,
      mediaCompositions,
      depth + 1,
    );

    if (subLayers.length === 0) {
      return null;
    }

    const { width, height } = getCompositionSize(nestedClip.compositionId);

    return {
      ...baseLayer,
      source: {
        type: 'image',
        nestedComposition: {
          compositionId: nestedClip.compositionId || nestedClip.id,
          layers: subLayers,
          width,
          height,
          currentTime: subCompTime,
          sceneClips: nestedClip.nestedClips,
          sceneTracks: nestedClip.nestedTracks,
        },
      },
    };
  }

  const exportVideo = getExportVideoElement(nestedClip, clipStates);
  if (nestedClip.source?.type === 'video') {
    const nestedClipTime = getNestedClipSourceTime(nestedClip, nestedClipLocalTime);
    return buildNestedVideoLayer(
      nestedClip,
      baseLayer,
      exportVideo,
      mainTimelineTime,
      clipStates,
      parallelDecoder,
      useParallelDecode,
      nestedClipTime,
    );
  }

  if (nestedClip.source?.type === 'image') {
    const imageElement = getExportImageElement(nestedClip, clipStates);
    return imageElement
      ? {
          ...baseLayer,
          source: { type: 'image', imageElement },
        }
      : null;
  }

  if (nestedClip.source?.type === 'motion-shape') {
    const source = buildMotionSource(nestedClip, nestedClipLocalTime);
    return source
      ? {
          ...baseLayer,
          source,
        }
      : null;
  }

  if (
    nestedClip.source?.type === 'motion-null' ||
    nestedClip.source?.type === 'motion-adjustment'
  ) {
    return null;
  }

  if (nestedClip.source?.type === 'model') {
    const nestedSourceTime = getNestedClipSourceTime(nestedClip, nestedClipLocalTime);
    return {
      ...baseLayer,
      source: buildModelSource(nestedClip, nestedSourceTime),
      is3D: true,
    };
  }

  if (nestedClip.source?.type === 'gaussian-splat') {
    return {
      ...baseLayer,
      source: buildGaussianSplatSource(nestedClip, nestedClipLocalTime),
      is3D: true,
    };
  }

  if (nestedClip.source?.type === 'light') {
    return {
      ...baseLayer,
      source: buildLightSource(nestedClip, nestedClipLocalTime, undefined, getNestedClipKeyframes(nestedClip)),
      is3D: true,
    };
  }

  if (isTextLikeClipSource(nestedClip)) {
    return buildTextLikeLayer(
      nestedClip,
      nestedClipLocalTime,
      nestedClip.startTime + nestedClipLocalTime,
      baseLayer,
      { interpolateTextBounds: false },
    );
  }

  return null;
}
