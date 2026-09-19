import type { TimelinePaintFadeVisuals } from '../../../timeline';
import type { TimelineClip } from '../../../types/timeline';
import { retimeKeyframesForEdgeTrim } from '../../../utils/keyframeTrimAnchoring';
import type { ClipTrimState } from '../types';
import { computeTrimTiming } from './clipTrimTiming';
import { isTimelineClipCanvasTrimPreviewClip } from './timelineClipCanvasClipGeometry';

type TimelineTrimFadeClip = Pick<
  TimelineClip,
  'id' | 'linkedClipId' | 'startTime' | 'duration' | 'inPoint' | 'outPoint' | 'source' | 'speed'
>;

/** Applies the live edge-trim timing to the opacity/audio curve painted on a clip. */
export function applyTimelineTrimFadePreview(
  fade: TimelinePaintFadeVisuals,
  clip: TimelineTrimFadeClip,
  clipTrim: ClipTrimState | null | undefined,
): TimelinePaintFadeVisuals {
  if (!clipTrim || !isTimelineClipCanvasTrimPreviewClip(clip, clipTrim)) return fade;

  const before = clip.id === clipTrim.clipId
    ? {
        startTime: clipTrim.originalStartTime,
        duration: clipTrim.originalDuration,
        inPoint: clipTrim.originalInPoint,
        outPoint: clipTrim.originalOutPoint,
      }
    : {
        startTime: clip.startTime,
        duration: clip.duration,
        inPoint: clip.inPoint,
        outPoint: clip.outPoint,
      };
  const after = computeTrimTiming(clip, clipTrim.edge, before, clipTrim.appliedDelta);

  return {
    ...fade,
    keyframes: retimeKeyframesForEdgeTrim(
      fade.keyframes,
      before,
      {
        startTime: after.newStartTime,
        duration: after.newDuration,
        inPoint: after.newInPoint,
        outPoint: after.newOutPoint,
      },
      { treatAllAsOpacity: !fade.isAudioClip },
    ),
    clipDuration: after.newDuration,
  };
}
