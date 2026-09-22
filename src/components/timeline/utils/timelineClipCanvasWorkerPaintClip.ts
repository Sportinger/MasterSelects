import type { TimelinePaintSourceClip } from '../../../timeline';
import type { StoryboardClipProperties } from '../../../types/storyboard';
import { cloneStoryboardClipProperties } from '../../../services/storyboard/core';
import { isTimelineClipCanvasAudioClip } from './timelineClipCanvasAudio';
import {
  resolveTimelineClipCanvasPaintVisuals,
  type TimelineClipCanvasPaintVisuals,
} from './timelineClipCanvasPaintVisualContributors';
import { resolveTimelineClipCanvasBodyFill } from './timelineClipCanvasAppearance';

export interface TimelineClipCanvasWorkerPaintClipInput {
  id: string;
  trackId?: string;
  label: string;
  startTime: number;
  duration: number;
  isAudio: boolean;
  hasCompositionSegmentThumbnails: boolean;
  visuals: TimelineClipCanvasPaintVisuals;
  bodyFill?: string;
  missingMedia: boolean;
  dataSourceType?: string | null;
  storyboardProperties?: StoryboardClipProperties;
}

export function createTimelineClipCanvasWorkerPaintClipInput(
  clip: TimelinePaintSourceClip,
  thumbnailsEnabled = true,
): TimelineClipCanvasWorkerPaintClipInput {
  const isAudio = isTimelineClipCanvasAudioClip(clip);
  const visuals = resolveTimelineClipCanvasPaintVisuals(clip);
  return {
    id: clip.id,
    trackId: clip.trackId,
    label: clip.sceneGraphOutput ? `${clip.sceneGraphOutput.nodeIds ? '[out]' : '[graph]'} ${clip.name}` : clip.name,
    startTime: clip.startTime,
    duration: clip.duration,
    isAudio,
    hasCompositionSegmentThumbnails: thumbnailsEnabled && !isAudio && Boolean(clip.clipSegments?.length),
    visuals: thumbnailsEnabled ? visuals : { ...visuals, thumbnail: false, sourceTimingNeedsThumbnail: false },
    bodyFill: resolveTimelineClipCanvasBodyFill(clip),
    missingMedia: clip.needsReload === true,
    dataSourceType: clip.source?.type,
    storyboardProperties: cloneStoryboardClipProperties(clip.storyboardProperties),
  };
}
