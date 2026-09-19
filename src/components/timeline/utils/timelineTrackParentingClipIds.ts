import type { TimelineTrackProps } from '../types';

type TimelineTrackShellClip = TimelineTrackProps['clips'][number];

export const buildTimelineTrackParentingClipIds = ({
  trackClips,
  selectedClipIds,
  hoveredClipId,
  pickWhipDrag,
  parentingEnabled,
}: {
  trackClips: readonly TimelineTrackShellClip[];
  selectedClipIds: ReadonlySet<string>;
  hoveredClipId: string | null;
  pickWhipDrag: { sourceClipId: string; targetClipId: string | null } | null;
  parentingEnabled: boolean;
}): Set<string> => {
  const ids = new Set<string>();
  if (!parentingEnabled) return ids;
  for (const clip of trackClips) {
    if (
      clip.parentClipId || selectedClipIds.has(clip.id) || hoveredClipId === clip.id ||
      pickWhipDrag?.sourceClipId === clip.id || pickWhipDrag?.targetClipId === clip.id
    ) ids.add(clip.id);
  }
  return ids;
};
