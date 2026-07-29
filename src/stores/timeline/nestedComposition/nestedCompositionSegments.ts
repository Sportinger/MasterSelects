import type { CompositionTimelineData, TimelineClip } from '../types';
import { Logger } from '../../../services/logger';
import { generateTimelineNestedClipSegmentThumbnails } from '../../../services/timeline/timelineNestedCompositionThumbnailRuntime';
import type {
  NestedCompositionStoreGet,
  NestedCompositionStoreSet,
} from '../nestedCompositionLoader';

const log = Logger.create('NestedCompositionLoader');

/**
 * Calculate normalized boundary positions (0-1) for all clips in a nested composition.
 * These are used to render visual markers showing where clips start/end.
 */
export function calculateNestedClipBoundaries(
  timelineData: CompositionTimelineData | undefined,
  compDuration: number,
): number[] {
  if (!timelineData?.clips || !timelineData?.tracks || compDuration <= 0) {
    return [];
  }

  const videoTrackIds = new Set(
    timelineData.tracks
      .filter((t: { type: string; visible?: boolean }) => t.type === 'video' && t.visible !== false)
      .map((t: { id: string }) => t.id),
  );

  const boundaries = new Set<number>();

  for (const clip of timelineData.clips) {
    if (!videoTrackIds.has(clip.trackId)) continue;

    const startNorm = clip.startTime / compDuration;
    const endNorm = (clip.startTime + clip.duration) / compDuration;

    if (startNorm >= 0 && startNorm <= 1) {
      boundaries.add(startNorm);
    }
    if (endNorm >= 0 && endNorm <= 1) {
      boundaries.add(endNorm);
    }
  }

  return Array.from(boundaries)
    .filter(b => b > 0.001 && b < 0.999)
    .sort((a, b) => a - b);
}

/**
 * Build clip segments with thumbnails for nested composition display.
 * Each segment represents one clip with its own thumbnails.
 */
export interface ClipSegmentData {
  clipId: string;
  clipName: string;
  startNorm: number;
  endNorm: number;
  thumbnails: string[];
  mediaFileId?: string;
  sourceInPoint?: number;
  sourceOutPoint?: number;
  reversed?: boolean;
}

export async function buildClipSegments(
  timelineData: CompositionTimelineData | undefined,
  compDuration: number,
  nestedClips: TimelineClip[],
): Promise<ClipSegmentData[]> {
  if (!timelineData?.clips || !timelineData?.tracks || compDuration <= 0) {
    return [];
  }

  const videoTrackIds = new Set(
    timelineData.tracks
      .filter((t: { type: string; visible?: boolean }) => t.type === 'video' && t.visible !== false)
      .map((t: { id: string }) => t.id),
  );

  const segments: ClipSegmentData[] = [];

  for (const serializedClip of timelineData.clips) {
    if (!videoTrackIds.has(serializedClip.trackId)) continue;
    if (serializedClip.sourceType === 'audio') continue;

    const startNorm = serializedClip.startTime / compDuration;
    const endNorm = (serializedClip.startTime + serializedClip.duration) / compDuration;
    const nestedClip = nestedClips.find(nc =>
      nc.id.includes(serializedClip.id) || nc.name === serializedClip.name
    );

    const clipDuration = serializedClip.outPoint - serializedClip.inPoint;
    const inPoint = serializedClip.inPoint || 0;
    const segmentWidth = endNorm - startNorm;
    const thumbCount = Math.max(1, Math.ceil(segmentWidth * 10));
    const thumbnails = await generateTimelineNestedClipSegmentThumbnails({
      clip: nestedClip,
      clipId: serializedClip.id,
      clipDuration,
      inPoint,
      maxCount: thumbCount,
    });

    segments.push({
      clipId: serializedClip.id,
      clipName: serializedClip.name,
      startNorm,
      endNorm,
      thumbnails,
      mediaFileId: nestedClip?.source?.mediaFileId ?? nestedClip?.mediaFileId ?? serializedClip.mediaFileId,
      sourceInPoint: serializedClip.inPoint,
      sourceOutPoint: serializedClip.outPoint,
      reversed: serializedClip.reversed,
    });
  }

  segments.sort((a, b) => a.startNorm - b.startNorm);

  log.info('Built clip segments', {
    segmentCount: segments.length,
    segments: segments.map(s => ({
      name: s.clipName,
      range: `${(s.startNorm * 100).toFixed(1)}%-${(s.endNorm * 100).toFixed(1)}%`,
      thumbCount: s.thumbnails.length,
    })),
  });

  return segments;
}

export interface ScheduleNestedClipSegmentBuildParams {
  clipId: string;
  timelineData: CompositionTimelineData | undefined;
  compDuration: number;
  nestedClips: TimelineClip[];
  thumbnailsEnabled: boolean;
  get: NestedCompositionStoreGet;
  set: NestedCompositionStoreSet;
  isCurrentTimelineSession?: () => boolean;
  delayMs?: number;
  logLabel?: string;
}

export type ApplyNestedClipSegmentBuildParams = Omit<
  ScheduleNestedClipSegmentBuildParams,
  'thumbnailsEnabled' | 'delayMs'
>;

export async function buildAndApplyNestedClipSegments(params: ApplyNestedClipSegmentBuildParams): Promise<void> {
  const {
    clipId,
    timelineData,
    compDuration,
    nestedClips,
    get,
    set,
    isCurrentTimelineSession,
    logLabel = 'Set clip segments for nested comp',
  } = params;

  if (isCurrentTimelineSession && !isCurrentTimelineSession()) {
    return;
  }

  const freshCompClip = get().clips.find(clip => clip.id === clipId);
  if (!freshCompClip) {
    return;
  }

  const freshNestedClips = freshCompClip.nestedClips || nestedClips;
  const clipSegments = await buildClipSegments(
    timelineData,
    compDuration,
    freshNestedClips,
  );

  if (isCurrentTimelineSession && !isCurrentTimelineSession()) {
    return;
  }

  if (clipSegments.length > 0) {
    set({
      clips: get().clips.map(clip =>
        clip.id === clipId ? { ...clip, clipSegments } : clip
      ),
    });
    log.info(logLabel, { clipId, segmentCount: clipSegments.length });
  }
}

export function scheduleNestedClipSegmentBuild(params: ScheduleNestedClipSegmentBuildParams): void {
  const {
    thumbnailsEnabled,
    delayMs = 500,
  } = params;

  if (!thumbnailsEnabled) {
    return;
  }

  setTimeout(() => {
    void buildAndApplyNestedClipSegments(params);
  }, delayMs);
}
