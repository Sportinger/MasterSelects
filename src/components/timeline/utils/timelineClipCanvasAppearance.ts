import type { TimelinePaintSourceClip } from '../../../timeline';

export const TIMELINE_MISSING_MEDIA_FILL = 'rgba(92, 32, 38, 0.82)';
export const TIMELINE_MISSING_MEDIA_TINT = 'rgba(248, 113, 113, 0.12)';
export const TIMELINE_MISSING_MEDIA_BORDER = 'rgba(248, 113, 113, 0.96)';

function getSolidFill(clip: TimelinePaintSourceClip): string | undefined {
  if (clip.source?.type !== 'solid') return undefined;
  return (clip as TimelinePaintSourceClip & { solidColor?: string }).solidColor
    ?? (clip.source as { color?: string }).color;
}

export function resolveTimelineClipCanvasBodyFill(
  clip: TimelinePaintSourceClip,
  fallback?: string,
): string | undefined {
  if (clip.needsReload) return TIMELINE_MISSING_MEDIA_FILL;
  return getSolidFill(clip) ?? fallback;
}

