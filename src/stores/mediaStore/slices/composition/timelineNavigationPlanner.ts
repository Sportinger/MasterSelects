import type { Composition } from '../../types';
import type { TimelineClip } from '../../../../types/timeline';

interface TimelineNavigationSnapshot {
  playheadPosition: number;
  clips: TimelineClip[];
}

export function calculateSyncedPlayhead(
  fromCompId: string | null,
  toCompId: string | null,
  compositions: Composition[],
  timelineStore: TimelineNavigationSnapshot,
): number | null {
  if (!fromCompId || !toCompId) return null;

  const currentPlayhead = timelineStore.playheadPosition;
  const currentClips = timelineStore.clips;
  const nestedClip = currentClips.find(
    (c) => c.isComposition && c.compositionId === toCompId,
  );
  if (nestedClip) {
    const clipStart = nestedClip.startTime;
    const clipEnd = clipStart + nestedClip.duration;
    const inPoint = nestedClip.inPoint || 0;

    if (currentPlayhead >= clipStart && currentPlayhead < clipEnd) {
      return (currentPlayhead - clipStart) + inPoint;
    }
  }

  const toComp = compositions.find((c) => c.id === toCompId);
  if (toComp?.timelineData?.clips) {
    const parentClip = toComp.timelineData.clips.find(
      (c: { isComposition?: boolean; compositionId?: string; startTime: number; inPoint?: number }) =>
        c.isComposition && c.compositionId === fromCompId,
    );
    if (parentClip) {
      return parentClip.startTime + (currentPlayhead - (parentClip.inPoint || 0));
    }
  }

  return null;
}

export function getCompositionSwitchDirection(
  currentActiveId: string | null,
  newId: string | null,
  openCompositionIds: string[],
): 'forward' | 'backward' {
  const currentIndex = currentActiveId ? openCompositionIds.indexOf(currentActiveId) : -1;
  const nextIndex = newId ? openCompositionIds.indexOf(newId) : -1;

  if (currentIndex !== -1 && nextIndex !== -1 && nextIndex > currentIndex) {
    return 'backward';
  }

  return 'forward';
}
