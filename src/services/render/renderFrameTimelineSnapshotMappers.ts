import type {
  RenderMediaAssetRef,
  RenderTimelineClipSnapshot,
  RenderTimelineClipSource,
  RenderTimelineTrackSnapshot,
} from '../../engine/render/contracts';
import type { MediaFile } from '../../stores/mediaStore';
import { compileRuntimeColorGrade } from '../../types';
import type {
  Keyframe,
  SerializableClip,
  TimelineClip,
  TimelineClipDataSource,
  TimelineTrack,
} from '../../types';

export function cloneData<T>(value: T | undefined): T | undefined {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value)) as T;
}

export function cloneKeyframeMap(
  keyframes: ReadonlyMap<string, readonly Keyframe[]>,
): ReadonlyMap<string, readonly Keyframe[]> {
  return new Map([...keyframes.entries()].map(([clipId, entries]) => [clipId, cloneData(entries) ?? []]));
}

export function mapTrack(track: TimelineTrack): RenderTimelineTrackSnapshot {
  return {
    id: track.id,
    name: track.name,
    type: track.type,
    height: track.height,
    labelColor: track.labelColor,
    muted: track.muted,
    visible: track.visible,
    solo: track.solo,
    locked: track.locked,
    parentTrackId: track.parentTrackId,
    audioState: cloneData(track.audioState),
    midiInstrument: cloneData(track.midiInstrument),
  };
}

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

function mapClipSource(
  source: TimelineClipDataSource | null | undefined,
  mediaFileId: string | undefined,
  mediaById: ReadonlyMap<string, MediaFile>,
): RenderTimelineClipSource | null {
  if (!source) return null;
  const sourceMediaFileId = mediaFileId ?? source.mediaFileId;
  const mediaFile = sourceMediaFileId ? mediaById.get(sourceMediaFileId) : undefined;
  return {
    type: source.type,
    assetRef: mapAssetRef(sourceMediaFileId, mediaFile),
    modelFileName: source.modelFileName,
    modelSequence: cloneData(source.modelSequence),
    gaussianSplatSequence: cloneData(source.gaussianSplatSequence),
    threeDEffectorsEnabled: source.threeDEffectorsEnabled,
    meshType: source.meshType,
    text3DProperties: cloneData(source.text3DProperties),
    cameraSettings: cloneData(source.cameraSettings),
    splatEffectorSettings: cloneData(source.splatEffectorSettings),
    gaussianBlendshapes: cloneData(source.gaussianBlendshapes),
    gaussianSplatFileName: source.gaussianSplatFileName,
    gaussianSplatFileHash: source.gaussianSplatFileHash,
    gaussianSplatSettings: cloneData(source.gaussianSplatSettings),
    naturalDuration: source.naturalDuration,
    mediaFileId: source.mediaFileId,
    vectorAnimationSettings: cloneData(source.vectorAnimationSettings),
    filePath: source.filePath,
  };
}

export function mapTimelineClip(
  clip: TimelineClip,
  mediaById: ReadonlyMap<string, MediaFile>,
  depth = 0,
): RenderTimelineClipSnapshot {
  return {
    id: clip.id,
    trackId: clip.trackId,
    name: clip.name,
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    source: mapClipSource(clip.source, clip.mediaFileId, mediaById),
    mediaFileId: clip.mediaFileId,
    signalAssetId: clip.signalAssetId,
    signalRefId: clip.signalRefId,
    signalRenderAdapterId: clip.signalRenderAdapterId,
    linkedClipId: clip.linkedClipId,
    linkedGroupId: clip.linkedGroupId,
    parentClipId: clip.parentClipId,
    transform: cloneData(clip.transform)!,
    effects: cloneData(clip.effects) ?? [],
    colorCorrection: compileRuntimeColorGrade(clip.colorCorrection),
    audioState: cloneData(clip.audioState),
    waveform: cloneData(clip.waveform),
    waveformChannels: cloneData(clip.waveformChannels),
    reversed: clip.reversed,
    speed: clip.speed,
    preservesPitch: clip.preservesPitch,
    isComposition: clip.isComposition,
    compositionId: clip.compositionId,
    nestedClips: depth < 8 ? clip.nestedClips?.map((entry) => mapTimelineClip(entry, mediaById, depth + 1)) : undefined,
    nestedTracks: depth < 8 ? clip.nestedTracks?.map(mapTrack) : undefined,
    masks: cloneData(clip.masks),
    textProperties: cloneData(clip.textProperties),
    text3DProperties: cloneData(clip.text3DProperties),
    motion: cloneData(clip.motion),
    transitionIn: cloneData(clip.transitionIn),
    transitionOut: cloneData(clip.transitionOut),
    is3D: clip.is3D,
    wireframe: clip.wireframe,
    meshType: clip.meshType,
  };
}

export function mapSerializableClip(
  clip: SerializableClip,
  mediaById: ReadonlyMap<string, MediaFile>,
): RenderTimelineClipSnapshot {
  const mediaFile = mediaById.get(clip.mediaFileId);
  return {
    id: clip.id,
    trackId: clip.trackId,
    name: clip.id,
    startTime: clip.startTime,
    duration: clip.duration,
    inPoint: clip.inPoint,
    outPoint: clip.outPoint,
    source: {
      type: clip.sourceType,
      assetRef: mapAssetRef(clip.mediaFileId, mediaFile),
      mediaFileId: clip.mediaFileId,
      naturalDuration: clip.naturalDuration,
      modelSequence: cloneData(clip.modelSequence),
      gaussianSplatSequence: cloneData(clip.gaussianSplatSequence),
      threeDEffectorsEnabled: clip.threeDEffectorsEnabled,
      meshType: clip.meshType,
      text3DProperties: cloneData(clip.text3DProperties),
      cameraSettings: cloneData(clip.cameraSettings),
      splatEffectorSettings: cloneData(clip.splatEffectorSettings),
      gaussianBlendshapes: cloneData(clip.gaussianBlendshapes),
      gaussianSplatSettings: cloneData(clip.gaussianSplatSettings),
      vectorAnimationSettings: cloneData(clip.vectorAnimationSettings),
    },
    mediaFileId: clip.mediaFileId,
    signalAssetId: clip.signalAssetId,
    signalRefId: clip.signalRefId,
    signalRenderAdapterId: clip.signalRenderAdapterId,
    linkedClipId: clip.linkedClipId,
    linkedGroupId: clip.linkedGroupId,
    transform: cloneData(clip.transform)!,
    effects: cloneData(clip.effects) ?? [],
    colorCorrection: compileRuntimeColorGrade(clip.colorCorrection),
    audioState: cloneData(clip.audioState),
    waveform: cloneData(clip.waveform),
    waveformChannels: cloneData(clip.waveformChannels),
    reversed: clip.reversed,
    speed: clip.speed,
    preservesPitch: clip.preservesPitch,
    isComposition: clip.isComposition,
    compositionId: clip.compositionId,
    masks: cloneData(clip.masks),
    textProperties: cloneData(clip.textProperties),
    text3DProperties: cloneData(clip.text3DProperties),
    motion: cloneData(clip.motion),
    transitionIn: cloneData(clip.transitionIn),
    transitionOut: cloneData(clip.transitionOut),
    is3D: clip.is3D,
    meshType: clip.meshType,
  };
}

export function getClipsAtTime(
  clips: readonly RenderTimelineClipSnapshot[],
  time: number,
): readonly RenderTimelineClipSnapshot[] {
  const epsilon = 1e-6;
  const activeClips = clips.filter((clip) => (
    time + epsilon >= clip.startTime &&
    time < clip.startTime + clip.duration
  ));
  if (activeClips.length <= 1) return activeClips;

  const activeByTrack = new Map<string, RenderTimelineClipSnapshot[]>();
  for (const clip of activeClips) {
    const trackClips = activeByTrack.get(clip.trackId) ?? [];
    trackClips.push(clip);
    activeByTrack.set(clip.trackId, trackClips);
  }

  const resolvedIds = new Set<string>();
  for (const trackClips of activeByTrack.values()) {
    if (trackClips.length === 1) {
      resolvedIds.add(trackClips[0].id);
      continue;
    }
    const sortedClips = trackClips.toSorted((a, b) => a.startTime - b.startTime);
    const latestClip = sortedClips[sortedClips.length - 1];
    const isBoundaryOnlyOverlap =
      time >= latestClip.startTime &&
      sortedClips.every((clip) => (
        clip.id === latestClip.id ||
        clip.startTime + clip.duration <= latestClip.startTime + epsilon
      ));
    if (isBoundaryOnlyOverlap) {
      resolvedIds.add(latestClip.id);
    } else {
      sortedClips.forEach((clip) => resolvedIds.add(clip.id));
    }
  }
  return activeClips.filter((clip) => resolvedIds.has(clip.id));
}
