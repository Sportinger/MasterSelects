import type { Composition, MediaFile } from '../stores/mediaStore';
import { DEFAULT_TRANSFORM } from '../stores/timeline/constants';
import { generateClipId } from '../stores/timeline/helpers/idGenerator';
import type { TimelineClip } from '../types';

export function collectUsedLiveInputIds(
  clips: readonly Pick<TimelineClip, 'source'>[],
  compositions: readonly Pick<Composition, 'timelineData'>[],
): string[] {
  const ids = new Set<string>();
  clips.forEach((clip) => {
    if (clip.source?.liveInputId) ids.add(clip.source.liveInputId);
  });
  compositions.forEach((composition) => {
    composition.timelineData?.clips.forEach((clip) => {
      if (clip.liveInputId) ids.add(clip.liveInputId);
    });
  });
  return [...ids];
}

export function isLiveInputUsedOutsideComposition(
  liveInputId: string,
  compositionId: string,
  activeCompositionId: string | null,
  clips: readonly Pick<TimelineClip, 'source'>[],
  compositions: readonly Pick<Composition, 'id' | 'timelineData'>[],
): boolean {
  if (
    activeCompositionId &&
    activeCompositionId !== compositionId &&
    clips.some((clip) => clip.source?.liveInputId === liveInputId)
  ) return true;
  return compositions.some((composition) => (
    composition.id !== compositionId &&
    composition.timelineData?.clips.some((clip) => clip.liveInputId === liveInputId)
  ));
}

export function canPlaceLiveInputInActiveComposition(
  item: Pick<MediaFile, 'liveInput'>,
  activeCompositionId: string | null,
): boolean {
  return item.liveInput?.kind !== 'composition-feedback' || item.liveInput.compositionId === activeCompositionId;
}

export function createLiveInputTimelineClip(params: {
  item: MediaFile;
  trackId: string;
  startTime: number;
  duration?: number;
  id?: string;
}): TimelineClip | null {
  if (!params.item.liveInput) return null;
  const duration = Math.max(0.001, params.duration ?? params.item.duration ?? 5);
  return {
    id: params.id ?? generateClipId('clip-live'),
    trackId: params.trackId,
    name: params.item.name,
    file: new File([], 'live-input.dat', { type: 'application/octet-stream' }),
    mediaFileId: params.item.id,
    startTime: params.startTime,
    duration,
    inPoint: 0,
    outPoint: duration,
    source: {
      type: 'video',
      liveInputId: params.item.id,
      mediaFileId: params.item.id,
      naturalDuration: Number.MAX_SAFE_INTEGER,
    },
    transform: { ...DEFAULT_TRANSFORM },
    effects: [],
    isLoading: false,
  };
}
