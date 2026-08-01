import type { CompositionTimelineData, SerializableClip, TimelineClip } from '../../../../types/timeline';
import { generateId } from '../../helpers/importPipeline';

const DURATION_SYNC_EPSILON = 0.0001;
const AUTO_TIMELINE_MIN_DURATION = 60;
const AUTO_TIMELINE_PADDING_SECONDS = 10;

export type NestedCompReferenceClip =
  Pick<SerializableClip, 'isComposition' | 'compositionId' | 'inPoint' | 'outPoint' | 'duration'> &
  Partial<Pick<SerializableClip, 'sourceType' | 'naturalDuration' | 'waveform'>> &
  Partial<Pick<TimelineClip, 'source'>>;

export function createDefaultCompositionTimelineData(
  duration: number,
  options: { durationLocked?: boolean } = {},
): CompositionTimelineData {
  return {
    tracks: [
      { id: `video-1-${generateId()}`, name: 'Video 1', type: 'video' as const, height: 60, muted: false, visible: true, solo: false },
      { id: `audio-1-${generateId()}`, name: 'Audio 1', type: 'audio' as const, height: 40, muted: false, visible: true, solo: false },
    ],
    clips: [],
    playheadPosition: 0,
    duration,
    ...(options.durationLocked ? { durationLocked: true } : {}),
    zoom: 50,
    scrollX: 0,
    inPoint: null,
    outPoint: null,
    loopPlayback: false,
  };
}

function clampTimelineBounds(
  duration: number,
  playheadPosition: number,
  inPoint: number | null,
  outPoint: number | null,
): Pick<CompositionTimelineData, 'playheadPosition' | 'inPoint' | 'outPoint'> {
  const clampedPlayhead = Math.max(0, Math.min(playheadPosition, duration));
  const clampedInPoint = inPoint === null ? null : Math.max(0, Math.min(inPoint, duration));
  const clampedOutPoint = outPoint === null ? null : Math.max(clampedInPoint ?? 0, Math.min(outPoint, duration));

  return {
    playheadPosition: clampedPlayhead,
    inPoint: clampedInPoint,
    outPoint: clampedOutPoint,
  };
}

function calculateUnlockedTimelineDuration(
  clips: Array<Pick<SerializableClip, 'startTime' | 'duration'>>,
): number {
  if (clips.length === 0) {
    return AUTO_TIMELINE_MIN_DURATION;
  }

  const maxEnd = Math.max(...clips.map((clip) => clip.startTime + clip.duration));
  return Math.max(AUTO_TIMELINE_MIN_DURATION, maxEnd + AUTO_TIMELINE_PADDING_SECONDS);
}

export function syncNestedCompReferenceClip<T extends NestedCompReferenceClip>(
  clip: T,
  compositionId: string,
  previousDuration: number,
  nextDuration: number,
  options?: { clearWaveform?: boolean },
): T {
  if (!clip.isComposition || clip.compositionId !== compositionId) {
    return clip;
  }

  const reachesPreviousCompEnd =
    previousDuration <= DURATION_SYNC_EPSILON ||
    Math.abs(clip.outPoint - previousDuration) <= DURATION_SYNC_EPSILON;
  const nextOutPoint = reachesPreviousCompEnd
    ? nextDuration
    : Math.min(clip.outPoint, nextDuration);
  const nextInPoint = Math.min(clip.inPoint, nextOutPoint);
  const nextClipDuration = Math.max(0, nextOutPoint - nextInPoint);

  const nextNaturalDuration = nextDuration;
  const currentNaturalDuration = 'source' in clip
    ? clip.source?.naturalDuration
    : clip.naturalDuration;
  const needsUpdate =
    clip.inPoint !== nextInPoint ||
    clip.outPoint !== nextOutPoint ||
    clip.duration !== nextClipDuration ||
    currentNaturalDuration !== nextNaturalDuration;

  if (!needsUpdate) {
    return clip;
  }

  const updatedClip: T = {
    ...clip,
    inPoint: nextInPoint,
    outPoint: nextOutPoint,
    duration: nextClipDuration,
  };

  if ('source' in clip) {
    updatedClip.source = clip.source
      ? { ...clip.source, naturalDuration: nextNaturalDuration }
      : clip.source;
  } else {
    updatedClip.naturalDuration = nextNaturalDuration;
    if (options?.clearWaveform && clip.sourceType === 'audio') {
      updatedClip.waveform = undefined;
    }
  }

  return updatedClip;
}

export function lockTimelineDuration(
  timelineData: CompositionTimelineData | undefined,
  duration: number,
): CompositionTimelineData | undefined {
  if (!timelineData) {
    return timelineData;
  }

  const clampedBounds = clampTimelineBounds(
    duration,
    timelineData.playheadPosition,
    timelineData.inPoint,
    timelineData.outPoint,
  );

  return {
    ...timelineData,
    duration,
    durationLocked: true,
    ...clampedBounds,
  };
}

export function syncTimelineDataNestedCompReferences(
  timelineData: CompositionTimelineData | undefined,
  compositionId: string,
  previousDuration: number,
  nextDuration: number,
): CompositionTimelineData | undefined {
  if (!timelineData) {
    return timelineData;
  }

  let changed = false;
  const updatedClips = timelineData.clips.map((clip) => {
    const updatedClip = syncNestedCompReferenceClip(
      clip,
      compositionId,
      previousDuration,
      nextDuration,
      { clearWaveform: true },
    );
    if (updatedClip !== clip) {
      changed = true;
    }
    return updatedClip;
  });

  if (!changed) {
    return timelineData;
  }

  const duration = timelineData.durationLocked
    ? timelineData.duration
    : calculateUnlockedTimelineDuration(updatedClips);
  const clampedBounds = clampTimelineBounds(
    duration,
    timelineData.playheadPosition,
    timelineData.inPoint,
    timelineData.outPoint,
  );

  return {
    ...timelineData,
    clips: updatedClips,
    duration,
    ...clampedBounds,
  };
}
