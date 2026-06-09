import type {
  RenderFrameSnapshot,
  RenderResolution,
} from '../../engine/render/contracts';
import { useEngineStore } from '../../stores/engineStore';
import type { Composition, MediaFile } from '../../stores/mediaStore';
import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import {
  mapComposition,
  mapMediaFile,
  mapSlotClipSettings,
} from './renderFrameMediaSnapshotMappers';
import {
  cloneData,
  cloneKeyframeMap,
  getClipsAtTime,
  mapTimelineClip,
  mapTrack,
} from './renderFrameTimelineSnapshotMappers';

export interface CaptureRenderFrameSnapshotInput {
  time?: number;
  fps?: number;
  frameToleranceMicros?: number;
  resolution?: RenderResolution;
}

function resolveResolution(
  input: CaptureRenderFrameSnapshotInput,
  activeComposition: Composition | undefined,
): RenderResolution {
  return input.resolution ?? {
    width: activeComposition?.width ?? 1920,
    height: activeComposition?.height ?? 1080,
  };
}

function resolvePrimarySelectedClipId(
  primarySelectedClipId: string | null,
  selectedClipIds: ReadonlySet<string>,
): string | null {
  return primarySelectedClipId && selectedClipIds.has(primarySelectedClipId)
    ? primarySelectedClipId
    : selectedClipIds.values().next().value ?? null;
}

export function captureRenderFrameSnapshot(
  input: CaptureRenderFrameSnapshotInput = {},
): RenderFrameSnapshot {
  const timelineState = useTimelineStore.getState();
  const mediaState = useMediaStore.getState();
  const engineState = useEngineStore.getState();
  const mediaById: ReadonlyMap<string, MediaFile> = new Map(
    mediaState.files.map((file) => [file.id, file]),
  );
  const activeComposition = mediaState.activeCompositionId
    ? mediaState.compositions.find((entry) => entry.id === mediaState.activeCompositionId)
    : undefined;
  const clips = timelineState.clips.map((clip) => mapTimelineClip(clip, mediaById));
  const time = input.time ?? timelineState.playheadPosition;

  return {
    time,
    fps: input.fps ?? activeComposition?.frameRate,
    frameToleranceMicros: input.frameToleranceMicros,
    resolution: resolveResolution(input, activeComposition),
    playback: {
      isPlaying: timelineState.isPlaying,
      isDraggingPlayhead: timelineState.isDraggingPlayhead,
      isExporting: timelineState.isExporting,
    },
    timeline: {
      clips,
      tracks: timelineState.tracks.map(mapTrack),
      clipKeyframes: cloneKeyframeMap(timelineState.clipKeyframes),
      selectedClipIds: new Set(timelineState.selectedClipIds),
      primarySelectedClipId: resolvePrimarySelectedClipId(
        timelineState.primarySelectedClipId,
        timelineState.selectedClipIds,
      ),
      selectedKeyframeIds: new Set(timelineState.selectedKeyframeIds),
      masterAudioState: cloneData(timelineState.masterAudioState),
      getClipsAtTime: (requestedTime) => getClipsAtTime(clips, requestedTime),
      interpolation: {
        getInterpolatedTransform: (clipId, localTime) => timelineState.getInterpolatedTransform(clipId, localTime),
        getInterpolatedEffects: (clipId, localTime) => timelineState.getInterpolatedEffects(clipId, localTime),
        getInterpolatedColorCorrection: (clipId, localTime) => timelineState.getInterpolatedColorCorrection(clipId, localTime),
        getInterpolatedVectorAnimationSettings: (clipId, localTime) => timelineState.getInterpolatedVectorAnimationSettings(clipId, localTime),
        getInterpolatedTextBounds: (clipId, localTime) => timelineState.getInterpolatedTextBounds(clipId, localTime),
        getSourceTimeForClip: (clipId, localTime) => timelineState.getSourceTimeForClip(clipId, localTime),
        getInterpolatedSpeed: (clipId, localTime) => timelineState.getInterpolatedSpeed(clipId, localTime),
      },
    },
    media: {
      activeCompositionId: mediaState.activeCompositionId,
      compositions: mediaState.compositions.map((composition) => mapComposition(composition, mediaById)),
      files: mediaState.files.map(mapMediaFile),
      activeLayerSlots: { ...mediaState.activeLayerSlots },
      layerOpacities: { ...mediaState.layerOpacities },
      slotClipSettings: mapSlotClipSettings(mediaState.slotClipSettings),
    },
    scene: {
      gizmo: {
        visible: engineState.sceneGizmoVisible !== false,
        mode: engineState.sceneGizmoMode,
        hoveredAxis: engineState.sceneGizmoHoveredAxis,
        clipIdOverride: engineState.sceneGizmoClipIdOverride,
      },
      previewCameraOverride: cloneData(engineState.previewCameraOverride) ?? null,
    },
  };
}
