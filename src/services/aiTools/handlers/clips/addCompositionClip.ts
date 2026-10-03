import { useTimelineStore } from '../../../../stores/timeline';
import { useMediaStore } from '../../../../stores/mediaStore';
import { isUserVisibleComposition } from '../../../../stores/mediaStore/compositionVisibility';
import type { ToolResult } from '../../types';
import { findOverlappingClip, resolveAddClipSegmentTrackId } from './addSegment';

/**
 * Places an existing composition as a nested composition clip on the active
 * timeline, the same way dragging it from the media panel does. Nested comps
 * are the reusable building blocks for scenes, lower thirds and templates.
 */
export async function handleAddCompositionClip(args: Record<string, unknown>): Promise<ToolResult> {
  const compositionId = typeof args.compositionId === 'string' ? args.compositionId : '';
  const startTime = args.startTime === undefined ? 0 : args.startTime;
  if (!compositionId) return { success: false, error: 'compositionId is required' };
  if (typeof startTime !== 'number' || !Number.isFinite(startTime) || startTime < 0) {
    return { success: false, error: 'startTime must be a finite number >= 0' };
  }
  const media = useMediaStore.getState();
  const composition = media.compositions.find(item => item.id === compositionId && isUserVisibleComposition(item));
  if (!composition) return { success: false, error: `Composition not found: ${compositionId}` };
  if (composition.id === media.activeCompositionId) {
    return { success: false, error: 'A composition cannot be nested into itself; open the parent composition first' };
  }

  const timeline = useTimelineStore.getState();
  const duration = composition.timelineData?.duration ?? composition.duration;
  const requestedTrackId = typeof args.trackId === 'string' ? args.trackId : null;
  let trackId = resolveAddClipSegmentTrackId(requestedTrackId, 'video', timeline.tracks, {
    clips: timeline.clips, startTime, endTime: startTime + duration,
  });
  if (requestedTrackId && !trackId) return { success: false, error: `Track not found: ${requestedTrackId}` };
  if (trackId && timeline.tracks.find(track => track.id === trackId)?.type !== 'video') {
    return { success: false, error: 'Composition clips need a video track' };
  }
  if (trackId && findOverlappingClip(timeline.clips, trackId, startTime, startTime + duration)) {
    if (requestedTrackId) return { success: false, error: `Track ${trackId} is not free for ${startTime}s-${startTime + duration}s` };
    trackId = undefined;
  }
  trackId ??= timeline.addTrack('video');

  const before = new Set(timeline.clips.map(clip => clip.id));
  await timeline.addCompClip(trackId, composition, startTime);
  const clip = useTimelineStore.getState().clips.find(item => !before.has(item.id)
    && item.compositionId === composition.id && item.trackId === trackId);
  if (!clip) return { success: false, error: 'The composition clip was not created (locked track or nesting cycle)' };
  return {
    success: true,
    data: {
      clipId: clip.id,
      compositionId: composition.id,
      trackId,
      startTime: clip.startTime,
      duration: clip.duration,
    },
  };
}
