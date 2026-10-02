import type { TimelineClip } from '../../../../types/timeline';

/** Current picture/audio first, then the open composition, then the rest of the library. */
export function prioritizeLinkedMedia<T extends { id: string }>(items: readonly T[], clips: readonly TimelineClip[], playhead: number): T[] {
  const priorities = new Map<string, number>();
  const visit = (tree: readonly TimelineClip[], time: number, parentActive: boolean) => {
    for (const clip of tree) {
      const active = parentActive && time >= clip.startTime && time < clip.startTime + clip.duration;
      const id = clip.source?.mediaFileId ?? clip.mediaFileId;
      if (id) priorities.set(id, Math.min(priorities.get(id) ?? 2, active ? 0 : 1));
      if (clip.nestedClips) visit(clip.nestedClips,
        (clip.inPoint ?? 0) + (time - clip.startTime) * (clip.speed ?? 1), active);
    }
  };
  visit(clips, playhead, true);
  return items.toSorted((a, b) => (priorities.get(a.id) ?? 2) - (priorities.get(b.id) ?? 2));
}
