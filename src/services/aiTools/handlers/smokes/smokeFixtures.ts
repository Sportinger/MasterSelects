import { renderHostPort } from '../../../render/renderHostPort';
import type { TimelineClip, TimelineTrack } from '../../../../types/timeline';
import { useTimelineStore } from '../../../../stores/timeline';
import { useMediaStore } from '../../../../stores/mediaStore';
import { DEFAULT_TRACKS, DEFAULT_TRANSFORM } from '../../../../stores/timeline/constants';
import type { MediaFile } from '../../../../stores/mediaStore/types';
import { clampNumber, hasBrowserDom, waitForFrames } from './smokeRuntime';

function createSmokeFile(name: string): File {
  if (typeof File === 'function') {
    return new File([], name, { type: 'application/octet-stream' });
  }
  return { name, size: 0, type: 'application/octet-stream' } as File;
}

export function createTimelineCanvasSmokeTracks(videoTrackCount: number, audioTrackCount = 0): TimelineTrack[] {
  const videoTracks = Array.from({ length: Math.max(1, Math.round(videoTrackCount)) }, (_, index): TimelineTrack => ({
    id: `smoke-video-${index + 1}`,
    name: `Smoke Video ${index + 1}`,
    type: 'video',
    height: 60,
    muted: false,
    visible: true,
    solo: false,
  }));

  const audioTracks = Array.from({ length: Math.max(0, Math.round(audioTrackCount)) }, (_, index): TimelineTrack => ({
    id: `smoke-audio-${index + 1}`,
    name: `Smoke Audio ${index + 1}`,
    type: 'audio',
    height: 44,
    muted: false,
    visible: true,
    solo: false,
  }));

  return [...videoTracks, ...audioTracks];
}

export function createTimelineCanvasSmokeClips(input: {
  tracks: readonly TimelineTrack[];
  clipCount: number;
  durationSeconds: number;
  clipDurationSeconds?: number;
  sourceType?: 'solid' | 'image' | 'video';
  imageElement?: HTMLImageElement;
  mediaFileId?: string;
  sourceDurationSeconds?: number;
}): TimelineClip[] {
  const videoTracks = input.tracks.filter((track) => track.type === 'video');
  const targetTracks = videoTracks.length > 0 ? videoTracks : input.tracks;
  const clipCount = Math.max(1, Math.round(input.clipCount));
  const clipDuration = clampNumber(input.clipDurationSeconds, 2, 0.05, 30);
  const durationSeconds = Math.max(clipDuration, input.durationSeconds);
  const lanes = Math.max(1, targetTracks.length);
  const colorPalette = ['#4c9aff', '#59d38c', '#f5c542', '#ff7a59', '#b98cff', '#5ed1d1'];

  return Array.from({ length: clipCount }, (_, index): TimelineClip => {
    const track = targetTracks[index % lanes];
    const laneIndex = Math.floor(index / lanes);
    const startTime = Math.min(
      Math.max(0, durationSeconds - clipDuration),
      laneIndex * (clipDuration + 0.18) + (index % 3) * 0.05,
    );
    const color = colorPalette[index % colorPalette.length];
    const source = input.sourceType === 'image' && input.imageElement
      ? {
        type: 'image' as const,
        imageElement: input.imageElement,
        naturalDuration: clipDuration,
      }
      : input.sourceType === 'video' && input.mediaFileId
        ? {
          type: 'video' as const,
          mediaFileId: input.mediaFileId,
          naturalDuration: input.sourceDurationSeconds ?? durationSeconds,
        }
      : {
        type: 'solid' as const,
        naturalDuration: clipDuration,
      };
    return {
      id: `smoke-clip-${index + 1}`,
      trackId: track.id,
      name: `Smoke Clip ${index + 1}`,
      file: createSmokeFile(`smoke-clip-${index + 1}.dat`),
      startTime,
      duration: clipDuration,
      inPoint: 0,
      outPoint: clipDuration,
      mediaFileId: input.sourceType === 'video' ? input.mediaFileId : undefined,
      source,
      solidColor: color,
      transform: { ...DEFAULT_TRANSFORM },
      effects: [],
      isLoading: false,
    };
  });
}

async function createSmokeImageElement(): Promise<HTMLImageElement | null> {
  if (!hasBrowserDom() || typeof Image !== 'function') {
    return null;
  }

  const canvas = document.createElement('canvas');
  canvas.width = 320;
  canvas.height = 180;
  const context = canvas.getContext('2d');
  if (!context) {
    return null;
  }

  context.fillStyle = '#2458d6';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#f3c742';
  context.fillRect(24, 24, 112, 112);
  context.fillStyle = '#ffffff';
  context.fillRect(156, 44, 132, 92);

  const image = new Image();
  const dataUrl = canvas.toDataURL('image/png');
  await new Promise<void>((resolve) => {
    image.onload = () => resolve();
    image.onerror = () => resolve();
    image.src = dataUrl;
  });

  return image.complete && image.naturalWidth > 0 ? image : null;
}

export async function createSyntheticTimeline(args: Record<string, unknown>): Promise<{
  trackCount: number;
  clipCount: number;
  durationSeconds: number;
}> {
  const clipCount = Math.round(clampNumber(args.clipCount, 720, 1, 5000));
  const videoTrackCount = Math.round(clampNumber(args.videoTrackCount, 8, 1, 64));
  const audioTrackCount = Math.round(clampNumber(args.audioTrackCount, 0, 0, 64));
  const durationSeconds = clampNumber(args.durationSeconds, 360, 5, 7200);
  const clipDurationSeconds = clampNumber(args.clipDurationSeconds, 2, 0.05, 60);
  const tracks = createTimelineCanvasSmokeTracks(videoTrackCount, audioTrackCount);
  const imageElement = args.syntheticSourceType === 'image'
    ? await createSmokeImageElement()
    : null;
  const syntheticVideoMediaFileId = typeof args.syntheticVideoMediaFileId === 'string'
    ? args.syntheticVideoMediaFileId
    : undefined;
  const clips = createTimelineCanvasSmokeClips({
    tracks,
    clipCount,
    durationSeconds,
    clipDurationSeconds,
    sourceType: syntheticVideoMediaFileId ? 'video' : imageElement ? 'image' : 'solid',
    imageElement: imageElement ?? undefined,
    mediaFileId: syntheticVideoMediaFileId,
    sourceDurationSeconds: clampNumber(args.syntheticSourceDurationSeconds, durationSeconds, 0.5, 7200),
  });
  const expandedTracks = new Set(tracks.map((track) => track.id));

  useTimelineStore.getState().pause();
  const currentState = useTimelineStore.getState();
  useTimelineStore.setState({
    tracks,
    clips,
    layers: [],
    selectedClipIds: new Set(),
    primarySelectedClipId: null,
    propertiesSelection: null,
    clipKeyframes: new Map(),
    selectedKeyframeIds: new Set(),
    expandedTracks,
    expandedTrackPropertyGroups: new Map(),
    expandedCurveProperties: new Map(),
    markers: [],
    duration: durationSeconds,
    durationLocked: true,
    playheadPosition: 0,
    waveformsEnabled: typeof args.waveformsEnabled === 'boolean'
      ? args.waveformsEnabled
      : currentState.waveformsEnabled,
    scrollX: 0,
    zoom: clampNumber(args.initialZoom, 12, 1, 1000),
    cachedFrameTimes: new Set(),
    ramPreviewRange: null,
    ramPreviewProgress: null,
    isRamPreviewing: false,
    timelineRangeSelection: null,
    clipDragPreview: null,
    timelineToolPreview: null,
  });
  renderHostPort.requestNewFrameRender();
  await waitForFrames(3);

  return {
    trackCount: tracks.length,
    clipCount: clips.length,
    durationSeconds,
  };
}

async function resolveSmokeMediaFile(args: Record<string, unknown>): Promise<{
  mediaFile: MediaFile;
  file: File;
} | null> {
  const requestedMediaFileId = typeof args.mediaFileId === 'string' ? args.mediaFileId : null;
  const mediaFile = useMediaStore.getState().files.find((candidate) => (
    candidate.type === 'video' &&
    (requestedMediaFileId ? candidate.id === requestedMediaFileId : true)
  ));
  if (!mediaFile) return null;

  if (mediaFile.file instanceof File) {
    return { mediaFile, file: mediaFile.file };
  }

  if (mediaFile.url) {
    try {
      const response = await fetch(mediaFile.url);
      const blob = await response.blob();
      if (blob.size > 0) {
        return {
          mediaFile,
          file: new File([blob], mediaFile.name, { type: blob.type || 'video/mp4' }),
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}

export async function createExistingMediaTimeline(args: Record<string, unknown>): Promise<{
  mediaFileId: string;
  mediaFileName: string;
  trackCount: number;
  clipCount: number;
  durationSeconds: number;
  clipId: string | undefined;
} | null> {
  const resolved = await resolveSmokeMediaFile(args);
  if (!resolved) return null;

  const mediaDuration = Math.max(0.5, resolved.mediaFile.duration || 5);
  const durationSeconds = clampNumber(args.durationSeconds, Math.min(mediaDuration, 18), 0.5, mediaDuration);
  const tracks = DEFAULT_TRACKS.map((track) => ({ ...track }));
  const expandedTracks = new Set(tracks.map((track) => track.id));
  useTimelineStore.getState().pause();
  useTimelineStore.setState({
    tracks,
    clips: [],
    layers: [],
    selectedClipIds: new Set(),
    primarySelectedClipId: null,
    propertiesSelection: null,
    clipKeyframes: new Map(),
    selectedKeyframeIds: new Set(),
    expandedTracks,
    expandedTrackPropertyGroups: new Map(),
    expandedCurveProperties: new Map(),
    markers: [],
    duration: durationSeconds,
    durationLocked: true,
    playheadPosition: 0,
    scrollX: 0,
    zoom: clampNumber(args.initialZoom, 72, 8, 1000),
    cachedFrameTimes: new Set(),
    ramPreviewRange: null,
    ramPreviewProgress: null,
    isRamPreviewing: false,
    timelineRangeSelection: null,
    clipDragPreview: null,
    timelineToolPreview: null,
  });
  const clipId = await useTimelineStore.getState().addClip(
    'video-1',
    resolved.file,
    0,
    durationSeconds,
    resolved.mediaFile.id,
    'video',
  );
  if (clipId) {
    useTimelineStore.getState().selectClip(clipId, false);
  }
  renderHostPort.requestNewFrameRender();
  await waitForFrames(8, 250);

  return {
    mediaFileId: resolved.mediaFile.id,
    mediaFileName: resolved.mediaFile.name,
    trackCount: useTimelineStore.getState().tracks.length,
    clipCount: useTimelineStore.getState().clips.length,
    durationSeconds,
    clipId,
  };
}
