import type { TimelineClip, TimelineTrack, VideoBakeRegion } from '../../types';
import { Logger } from '../../services/logger';
import { captureSnapshot } from '../historyStore';
import { useMediaStore } from '../mediaStore';
import { RAM_PREVIEW_FPS } from './constants';
import { generateClipId } from './helpers/idGenerator';
import type {
  SliceCreator,
  TimelineVideoBakeRegionSelection,
  VideoBakeActions,
} from './types';

const log = Logger.create('TimelineVideoBake');
const MIN_VIDEO_BAKE_REGION_SECONDS = 1 / 60;

function evenDimension(value: number): number {
  return Math.max(2, Math.round(value / 2) * 2);
}

function getActiveCompositionBakeContext(): { compositionId: string; width: number; height: number; fps: number } {
  const mediaState = useMediaStore.getState();
  const compositionId = mediaState.activeCompositionId || 'default';
  const composition = mediaState.compositions.find(candidate => candidate.id === compositionId);
  return {
    compositionId,
    width: evenDimension(composition?.width ?? 1920),
    height: evenDimension(composition?.height ?? 1080),
    fps: Math.max(1, Math.min(60, Math.round(composition?.frameRate ?? RAM_PREVIEW_FPS))),
  };
}

async function renderCompositionVideoBakeProxy(
  region: VideoBakeRegion,
  onProgress: (percent: number) => void,
): Promise<boolean> {
  const [{ FrameExporter }, { videoBakeProxyCache }] = await Promise.all([
    import('../../engine/export'),
    import('../../services/videoBakeProxyCache'),
  ]);
  const { compositionId, width, height, fps } = getActiveCompositionBakeContext();
  const h264Supported = await FrameExporter.checkCodecSupport('h264', width, height);
  const codec = h264Supported ? 'h264' : 'vp9';
  const container = h264Supported ? 'mp4' : 'webm';

  if (!h264Supported) {
    const vp9Supported = await FrameExporter.checkCodecSupport('vp9', width, height);
    if (!vp9Supported) {
      throw new Error('No browser video encoder is available for video bake proxies.');
    }
  }

  const exporter = new FrameExporter({
    width,
    height,
    fps,
    codec,
    container,
    bitrate: Math.max(2_000_000, Math.round(FrameExporter.getRecommendedBitrate(width, height, fps) * 0.55)),
    startTime: region.startTime,
    endTime: region.endTime,
    includeAudio: false,
    exportMode: 'fast',
    filename: `video-bake-${region.id}.${container}`,
  });

  const blob = await exporter.export((progress) => onProgress(progress.percent));
  if (!blob) return false;

  await videoBakeProxyCache.registerCompositionArtifact({
    region,
    compositionId,
    blob,
    width,
    height,
    fps,
  });
  return true;
}

function normalizeRange(
  startTime: number,
  endTime: number,
  minTime: number,
  maxTime: number,
): { startTime: number; endTime: number } | null {
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return null;
  const lowerBound = Math.min(minTime, maxTime);
  const upperBound = Math.max(minTime, maxTime);
  const start = Math.max(lowerBound, Math.min(upperBound, Math.min(startTime, endTime)));
  const end = Math.max(start, Math.min(upperBound, Math.max(startTime, endTime)));
  return end - start >= MIN_VIDEO_BAKE_REGION_SECONDS
    ? {
        startTime: Number(start.toFixed(6)),
        endTime: Number(end.toFixed(6)),
      }
    : null;
}

function normalizeSelection(
  selection: TimelineVideoBakeRegionSelection,
  minTime: number,
  maxTime: number,
): TimelineVideoBakeRegionSelection | null {
  const range = normalizeRange(selection.startTime, selection.endTime, minTime, maxTime);
  if (!range) return null;
  const sourceStart = selection.sourceInPoint;
  const sourceEnd = selection.sourceOutPoint;
  return {
    ...selection,
    ...range,
    ...(Number.isFinite(sourceStart) && Number.isFinite(sourceEnd)
      ? {
          sourceInPoint: Number(Math.min(sourceStart as number, sourceEnd as number).toFixed(6)),
          sourceOutPoint: Number(Math.max(sourceStart as number, sourceEnd as number).toFixed(6)),
        }
      : {}),
  };
}

function createVideoBakeRegion(
  input: Omit<VideoBakeRegion, 'id' | 'createdAt' | 'status'>,
): VideoBakeRegion {
  return {
    ...input,
    id: generateClipId('video-bake'),
    status: 'marked',
    createdAt: Date.now(),
  };
}

function resetBakedRegion(region: VideoBakeRegion): VideoBakeRegion {
  if (region.status !== 'baked' && region.status !== 'baking' && region.status !== 'error') {
    return region;
  }
  const { bakedAt: _bakedAt, error: _error, progress: _progress, ...rest } = region;
  return {
    ...rest,
    status: 'marked',
  };
}

export function resetVolatileVideoBakeRegionStatuses(
  clips: readonly TimelineClip[],
  videoBakeRegions: readonly VideoBakeRegion[],
): {
  clips: TimelineClip[];
  videoBakeRegions: VideoBakeRegion[];
} {
  return {
    videoBakeRegions: videoBakeRegions.map(resetBakedRegion),
    clips: clips.map((clip) => {
      const bakeRegions = clip.videoState?.bakeRegions;
      if (!bakeRegions?.length) return clip;
      return {
        ...clip,
        videoState: {
          ...clip.videoState,
          bakeRegions: bakeRegions.map(resetBakedRegion),
        },
      };
    }),
  };
}

function isVisualClipOnVideoTrack(
  clip: TimelineClip | undefined,
  tracks: readonly TimelineTrack[],
): boolean {
  if (!clip) return false;
  const track = tracks.find((candidate: { id: string }) => candidate.id === clip.trackId);
  return track?.type === 'video' && track.locked !== true && clip.source?.type !== 'audio';
}

function markCompositionRegionStatus(
  regions: readonly VideoBakeRegion[],
  regionId: string,
  patch: Partial<VideoBakeRegion>,
): VideoBakeRegion[] {
  return regions.map(region => region.id === regionId ? { ...region, ...patch } : region);
}

function markClipRegionStatus(
  clip: TimelineClip,
  regionId: string,
  patch: Partial<VideoBakeRegion>,
): TimelineClip {
  const regions = clip.videoState?.bakeRegions;
  if (!regions?.length) return clip;
  return {
    ...clip,
    videoState: {
      ...clip.videoState,
      bakeRegions: regions.map(region => region.id === regionId ? { ...region, ...patch } : region),
    },
  };
}

function sourceTimeToClipTimelineTime(clip: TimelineClip, sourceTime: number): number {
  const clipDuration = Math.max(MIN_VIDEO_BAKE_REGION_SECONDS, clip.duration);
  const sourceStart = clip.inPoint ?? 0;
  const sourceEnd = Math.max(sourceStart + MIN_VIDEO_BAKE_REGION_SECONDS, clip.outPoint ?? sourceStart + clipDuration);
  const sourceRatio = Math.max(0, Math.min(1, (sourceTime - sourceStart) / (sourceEnd - sourceStart)));
  const timelineRatio = clip.reversed ? 1 - sourceRatio : sourceRatio;
  return clip.startTime + timelineRatio * clipDuration;
}

function resolveClipRegionTimelineRange(
  clip: TimelineClip,
  region: VideoBakeRegion,
): { startTime: number; endTime: number } | null {
  if (Number.isFinite(region.sourceInPoint) && Number.isFinite(region.sourceOutPoint)) {
    return normalizeRange(
      sourceTimeToClipTimelineTime(clip, region.sourceInPoint as number),
      sourceTimeToClipTimelineTime(clip, region.sourceOutPoint as number),
      clip.startTime,
      clip.startTime + clip.duration,
    );
  }

  return normalizeRange(region.startTime, region.endTime, clip.startTime, clip.startTime + clip.duration);
}

function withoutRegionStatusRuntimeFields(region: VideoBakeRegion): VideoBakeRegion {
  const { bakedAt: _bakedAt, error: _error, progress: _progress, ...rest } = region;
  return rest;
}

export function serializeVideoBakeRegion(region: VideoBakeRegion): VideoBakeRegion {
  return {
    ...withoutRegionStatusRuntimeFields(region),
    status: 'marked',
  };
}

export const createVideoBakeSlice: SliceCreator<VideoBakeActions> = (set, get) => ({
  setVideoBakeRegionSelection: (selection) => {
    if (!selection) {
      set({ videoBakeRegionSelection: null });
      return;
    }
    const maxTime = selection.scope === 'clip'
      ? get().clips.find(clip => clip.id === selection.clipId)?.startTime ?? 0
      : get().duration;
    const clip = selection.scope === 'clip'
      ? get().clips.find(currentClip => currentClip.id === selection.clipId)
      : undefined;
    const normalized = normalizeSelection(
      selection,
      selection.scope === 'clip' && clip ? clip.startTime : 0,
      selection.scope === 'clip' && clip ? clip.startTime + clip.duration : maxTime,
    );
    set({ videoBakeRegionSelection: normalized });
  },

  clearVideoBakeRegionSelection: () => {
    set({ videoBakeRegionSelection: null });
  },

  addCompositionVideoBakeRegion: (startTime, endTime) => {
    const { duration, videoBakeRegions } = get();
    const range = normalizeRange(startTime, endTime, 0, duration);
    if (!range) {
      log.warn('Cannot add empty composition video bake region', { startTime, endTime });
      return null;
    }

    const region = createVideoBakeRegion({
      scope: 'composition',
      ...range,
    });

    captureSnapshot('Mark composition video bake region');
    set({
      videoBakeRegions: [...videoBakeRegions, region],
      videoBakeRegionSelection: null,
    });
    return region.id;
  },

  bakeCompositionVideoBakeRegion: async (regionId) => {
    const region = get().videoBakeRegions.find(candidate => candidate.id === regionId);
    if (!region) {
      log.warn('Cannot bake missing composition video region', { regionId });
      return false;
    }

    captureSnapshot('Bake composition video region');
    set({
      videoBakeRegions: markCompositionRegionStatus(get().videoBakeRegions, regionId, {
        status: 'baking',
        progress: 0,
        error: undefined,
      }),
    });

    try {
      await get().clearRamPreview();
      const { videoBakeProxyCache } = await import('../../services/videoBakeProxyCache');
      videoBakeProxyCache.remove(regionId);
      const completed = await renderCompositionVideoBakeProxy(region, (progress) => {
        set({
          videoBakeRegions: markCompositionRegionStatus(get().videoBakeRegions, regionId, {
            status: 'baking',
            progress,
          }),
        });
      });
      const stillBaking = get().videoBakeRegions.some(candidate =>
        candidate.id === regionId && candidate.status === 'baking'
      );
      if (!stillBaking) {
        videoBakeProxyCache.remove(regionId);
        return false;
      }

      set({
        videoBakeRegions: markCompositionRegionStatus(get().videoBakeRegions, regionId, completed
          ? {
              status: 'baked',
              progress: 100,
              bakedAt: Date.now(),
              error: undefined,
            }
          : {
              status: 'marked',
              progress: undefined,
              error: 'Bake cancelled',
            }),
      });
      return completed;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Video bake failed';
      log.error('Composition video bake failed', error);
      set({
        videoBakeRegions: markCompositionRegionStatus(get().videoBakeRegions, regionId, {
          status: 'error',
          progress: undefined,
          error: message,
        }),
      });
      return false;
    }
  },

  unbakeCompositionVideoBakeRegion: (regionId) => {
    const region = get().videoBakeRegions.find(candidate => candidate.id === regionId);
    if (!region) return false;

    captureSnapshot('Unbake composition video region');
    void import('../../services/videoBakeProxyCache').then(({ videoBakeProxyCache }) => {
      videoBakeProxyCache.remove(regionId);
    });
    void get().clearRamPreview();
    const resetState = resetVolatileVideoBakeRegionStatuses(get().clips, get().videoBakeRegions);
    set({
      ...resetState,
      videoBakeRegions: markCompositionRegionStatus(resetState.videoBakeRegions, regionId, {
        status: 'marked',
        progress: undefined,
        bakedAt: undefined,
        error: undefined,
      }),
    });
    return true;
  },

  removeCompositionVideoBakeRegion: (regionId) => {
    const region = get().videoBakeRegions.find(candidate => candidate.id === regionId);
    if (!region) return false;

    captureSnapshot('Remove composition video bake region');
    void import('../../services/videoBakeProxyCache').then(({ videoBakeProxyCache }) => {
      videoBakeProxyCache.remove(regionId);
    });
    if (region.status === 'baked' || region.status === 'baking') {
      void get().clearRamPreview();
      const resetState = resetVolatileVideoBakeRegionStatuses(get().clips, get().videoBakeRegions);
      set({
        ...resetState,
        videoBakeRegions: resetState.videoBakeRegions.filter(candidate => candidate.id !== regionId),
      });
      return true;
    }

    set({
      videoBakeRegions: get().videoBakeRegions.filter(candidate => candidate.id !== regionId),
    });
    return true;
  },

  addClipVideoBakeRegion: (clipId, selection) => {
    const { clips, tracks } = get();
    const clip = clips.find(candidate => candidate.id === clipId);
    if (!clip || !isVisualClipOnVideoTrack(clip, tracks)) {
      log.warn('Cannot add video bake region to missing, locked, or non-video clip', { clipId });
      return null;
    }

    const range = normalizeRange(selection.startTime, selection.endTime, clip.startTime, clip.startTime + clip.duration);
    if (!range) {
      log.warn('Cannot add empty clip video bake region', { clipId, selection });
      return null;
    }

    const rawSourceInPoint = selection.sourceInPoint;
    const rawSourceOutPoint = selection.sourceOutPoint;
    const hasSourceRange = Number.isFinite(rawSourceInPoint) && Number.isFinite(rawSourceOutPoint);
    const sourceInPoint = hasSourceRange
      ? Math.min(rawSourceInPoint as number, rawSourceOutPoint as number)
      : undefined;
    const sourceOutPoint = hasSourceRange
      ? Math.max(rawSourceInPoint as number, rawSourceOutPoint as number)
      : undefined;
    const region = createVideoBakeRegion({
      scope: 'clip',
      clipId,
      trackId: selection.trackId ?? clip.trackId,
      ...range,
      ...(sourceInPoint !== undefined && sourceOutPoint !== undefined
        ? {
            sourceInPoint: Number(sourceInPoint.toFixed(6)),
            sourceOutPoint: Number(sourceOutPoint.toFixed(6)),
          }
        : {}),
    });

    captureSnapshot('Mark clip video bake region');
    set({
      clips: clips.map(currentClip => currentClip.id === clipId
        ? {
            ...currentClip,
            videoState: {
              ...currentClip.videoState,
              bakeRegions: [
                ...(currentClip.videoState?.bakeRegions ?? []),
                region,
              ],
            },
          }
        : currentClip),
      videoBakeRegionSelection: null,
    });
    return region.id;
  },

  bakeClipVideoBakeRegion: async (clipId, regionId) => {
    const clip = get().clips.find(candidate => candidate.id === clipId);
    const region = clip?.videoState?.bakeRegions?.find(candidate => candidate.id === regionId);
    if (!clip || !region) {
      log.warn('Cannot bake missing clip video region', { clipId, regionId });
      return false;
    }
    const bakeRange = resolveClipRegionTimelineRange(clip, region);
    if (!bakeRange) {
      log.warn('Cannot bake empty clip video region', { clipId, regionId });
      return false;
    }

    captureSnapshot('Bake clip video region');
    set({
      clips: get().clips.map(currentClip => currentClip.id === clipId
        ? markClipRegionStatus(currentClip, regionId, {
            ...bakeRange,
            status: 'baking',
            progress: 0,
            error: undefined,
          })
        : currentClip),
    });

    const completed = await get().startRamPreviewForRange(bakeRange.startTime, bakeRange.endTime, {
      centerTime: (bakeRange.startTime + bakeRange.endTime) / 2,
      label: 'Bake clip video region',
    });

    set({
      clips: get().clips.map(currentClip => currentClip.id === clipId
        ? markClipRegionStatus(currentClip, regionId, completed
            ? {
                status: 'baked',
                progress: 100,
                bakedAt: Date.now(),
                error: undefined,
              }
            : {
                status: 'marked',
                progress: undefined,
                error: 'Bake cancelled',
              })
        : currentClip),
    });
    return completed;
  },

  unbakeClipVideoBakeRegion: (clipId, regionId) => {
    const clip = get().clips.find(candidate => candidate.id === clipId);
    const region = clip?.videoState?.bakeRegions?.find(candidate => candidate.id === regionId);
    if (!region) return false;

    captureSnapshot('Unbake clip video region');
    void get().clearRamPreview();
    const resetState = resetVolatileVideoBakeRegionStatuses(get().clips, get().videoBakeRegions);
    set({
      ...resetState,
      clips: resetState.clips.map(currentClip => currentClip.id === clipId
        ? markClipRegionStatus(currentClip, regionId, {
            status: 'marked',
            progress: undefined,
            bakedAt: undefined,
            error: undefined,
          })
        : currentClip),
    });
    return true;
  },

  removeClipVideoBakeRegion: (clipId, regionId) => {
    const clip = get().clips.find(candidate => candidate.id === clipId);
    const region = clip?.videoState?.bakeRegions?.find(candidate => candidate.id === regionId);
    if (!region) return false;

    captureSnapshot('Remove clip video bake region');
    if (region.status === 'baked' || region.status === 'baking') {
      void get().clearRamPreview();
      const resetState = resetVolatileVideoBakeRegionStatuses(get().clips, get().videoBakeRegions);
      set({
        ...resetState,
        clips: resetState.clips.map(currentClip => {
          if (currentClip.id !== clipId) return currentClip;
          return {
            ...currentClip,
            videoState: {
              ...currentClip.videoState,
              bakeRegions: (currentClip.videoState?.bakeRegions ?? [])
                .filter(candidate => candidate.id !== regionId),
            },
          };
        }),
      });
      return true;
    }

    set({
      clips: get().clips.map(currentClip => {
        if (currentClip.id !== clipId) return currentClip;
        return {
          ...currentClip,
          videoState: {
            ...currentClip.videoState,
            bakeRegions: (currentClip.videoState?.bakeRegions ?? [])
              .filter(candidate => candidate.id !== regionId),
          },
        };
      }),
    });
    return true;
  },
});
