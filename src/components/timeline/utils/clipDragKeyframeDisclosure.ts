import { useTimelineStore } from '../../../stores/timeline';

/** A real clip move keeps the timeline compact for the whole gesture and drop. */
export function collapseExpandedKeyframeTracksForClipDrag(): void {
  const { expandedTracks } = useTimelineStore.getState();
  if (expandedTracks.size === 0) return;
  useTimelineStore.setState({ expandedTracks: new Set() });
}

/** A click may reveal a selected clip's keyframes, but only after pointer release. */
export function expandClipKeyframeTrackAfterClickRelease(clipId: string): void {
  const state = useTimelineStore.getState();
  if (!state.selectedClipIds.has(clipId)) return;
  if ((state.clipKeyframes.get(clipId)?.length ?? 0) === 0) return;
  const clip = state.clips.find((candidate) => candidate.id === clipId);
  if (!clip || state.expandedTracks.has(clip.trackId)) return;

  const expandedTracks = new Set(state.expandedTracks);
  expandedTracks.add(clip.trackId);
  useTimelineStore.setState({ expandedTracks });
}
