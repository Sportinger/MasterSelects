import type { TimelinePaintSourceClip } from '../../../timeline';
import { getFlockThumbnailSourceIdForClip } from '../../../services/flock/flockThumbnailService';
import { getTimelineClipCanvasThumbnailMediaFileId } from './timelineClipCanvasThumbnailPreparation';

/** Thumbnail source for a clip: its media file, or the limited CPU flock preview. */
export function getTimelineClipCanvasThumbnailSourceId(clip: TimelinePaintSourceClip): string | null {
  return getTimelineClipCanvasThumbnailMediaFileId(clip) ?? getFlockThumbnailSourceIdForClip(clip);
}
