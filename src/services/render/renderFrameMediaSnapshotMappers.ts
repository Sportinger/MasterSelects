import type {
  RenderCompositionSnapshot,
  RenderCompositionTimelineSnapshot,
  RenderMediaAssetRef,
  RenderMediaFileSnapshot,
} from '../../engine/render/contracts';
import type { Composition, MediaFile, SlotClipSettings } from '../../stores/mediaStore';
import type { CompositionTimelineData } from '../../types';
import { cloneData, mapSerializableClip, mapTrack } from './renderFrameTimelineSnapshotMappers';

function mapAssetRef(mediaFileId: string | undefined, file: MediaFile | undefined): RenderMediaAssetRef | undefined {
  if (!mediaFileId && !file) return undefined;
  return {
    mediaFileId,
    fileName: file?.name,
    fileHash: file?.fileHash,
    fileSize: file?.fileSize,
    sourcePath: file?.filePath,
    projectPath: file?.projectPath,
    absolutePath: file?.absolutePath,
  };
}

function mapCompositionTimeline(
  data: CompositionTimelineData | undefined,
  mediaById: ReadonlyMap<string, MediaFile>,
): RenderCompositionTimelineSnapshot | undefined {
  if (!data) return undefined;
  return {
    tracks: data.tracks.map(mapTrack),
    clips: data.clips.map((clip) => mapSerializableClip(clip, mediaById)),
    playheadPosition: data.playheadPosition,
    duration: data.duration,
    durationLocked: data.durationLocked,
    zoom: data.zoom,
    scrollX: data.scrollX,
    inPoint: data.inPoint,
    outPoint: data.outPoint,
    clipKeyframes: Object.fromEntries(data.clips.map((clip) => [clip.id, cloneData(clip.keyframes) ?? []])),
    masterAudioState: cloneData(data.masterAudioState),
  };
}

export function mapComposition(
  composition: Composition,
  mediaById: ReadonlyMap<string, MediaFile>,
): RenderCompositionSnapshot {
  return {
    id: composition.id,
    name: composition.name,
    parentId: composition.parentId,
    createdAt: composition.createdAt,
    labelColor: composition.labelColor,
    width: composition.width,
    height: composition.height,
    frameRate: composition.frameRate,
    duration: composition.duration,
    backgroundColor: composition.backgroundColor,
    timelineData: mapCompositionTimeline(composition.timelineData, mediaById),
    camera: cloneData(composition.camera),
  };
}

export function mapMediaFile(file: MediaFile): RenderMediaFileSnapshot {
  return {
    id: file.id,
    name: file.name,
    type: file.type,
    parentId: file.parentId,
    createdAt: file.createdAt,
    labelColor: file.labelColor,
    assetRef: mapAssetRef(file.id, file) ?? { mediaFileId: file.id, fileName: file.name },
    modelSequence: cloneData(file.modelSequence),
    gaussianSplatSequence: cloneData(file.gaussianSplatSequence),
    vectorAnimation: cloneData(file.vectorAnimation),
    duration: file.duration,
    width: file.width,
    height: file.height,
    fps: file.fps,
    codec: file.codec,
    audioCodec: file.audioCodec,
    container: file.container,
    bitrate: file.bitrate,
    hasAudio: file.hasAudio,
  };
}

export function mapSlotClipSettings(settings: Record<string, SlotClipSettings> | undefined) {
  return Object.fromEntries(Object.entries(settings ?? {}).map(([id, value]) => [
    id,
    {
      trimIn: value.trimIn,
      trimOut: value.trimOut,
      endBehavior: value.endBehavior,
    },
  ]));
}
