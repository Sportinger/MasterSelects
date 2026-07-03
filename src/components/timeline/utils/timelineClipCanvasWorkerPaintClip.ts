import type { TimelinePaintSourceClip } from '../../../timeline';
import { isTimelineClipCanvasAudioClip } from './timelineClipCanvasAudio';
import {
  resolveTimelineClipCanvasPaintVisuals,
  type TimelineClipCanvasPaintVisuals,
} from './timelineClipCanvasPaintVisualContributors';

export interface TimelineClipCanvasWorkerPaintClipInput {
  id: string;
  trackId?: string;
  label: string;
  startTime: number;
  duration: number;
  isAudio: boolean;
  visuals: TimelineClipCanvasPaintVisuals;
  bodyFill?: string;
}

function getTimelineClipCanvasWorkerClipBodyFill(clip: TimelinePaintSourceClip): string | undefined {
  if (clip.source?.type !== 'solid') return undefined;
  return (clip as TimelinePaintSourceClip & { solidColor?: string }).solidColor ??
    (clip.source as { color?: string }).color;
}

export function createTimelineClipCanvasWorkerPaintClipInput(
  clip: TimelinePaintSourceClip,
): TimelineClipCanvasWorkerPaintClipInput {
  return {
    id: clip.id,
    trackId: clip.trackId,
    label: clip.name,
    startTime: clip.startTime,
    duration: clip.duration,
    isAudio: isTimelineClipCanvasAudioClip(clip),
    visuals: resolveTimelineClipCanvasPaintVisuals(clip),
    bodyFill: getTimelineClipCanvasWorkerClipBodyFill(clip),
  };
}
