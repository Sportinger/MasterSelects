import type { TimelinePaintSourceClip } from '../../../timeline';
import {
  getTimelineClipCanvasPassiveDecorationBadgeReserve,
  getTimelineClipCanvasPassiveDecorationBadges,
  type TimelineClipCanvasMediaStatus,
} from './timelineClipCanvasPassiveDecorations';
import type { TimelineClipCanvasGeometryInput } from './timelineClipCanvasClipGeometry';
import { resolveClipGeometry } from './timelineClipCanvasClipGeometry';

export type TimelineClipCanvasMediaStatusMap = ReadonlyMap<string, TimelineClipCanvasMediaStatus>;

export interface TimelineClipCanvasChromeBadge {
  label: string;
  fill: string;
  stroke?: string;
  width: number;
  right: number;
}

export interface TimelineClipCanvasChromeOverlay {
  id: string;
  iconType?: string;
  showIcon: boolean;
  label: string;
  left: number;
  width: number;
  badges: readonly TimelineClipCanvasChromeBadge[];
  badgeReserve: number;
}

export function getTimelineClipCanvasMediaFileId(clip: TimelinePaintSourceClip): string | null {
  return clip.source?.mediaFileId ?? clip.mediaFileId ?? null;
}

export function getTimelineClipCanvasMediaStatus(
  clip: TimelinePaintSourceClip,
  mediaFileStatusById: TimelineClipCanvasMediaStatusMap,
): TimelineClipCanvasMediaStatus | undefined {
  const mediaFileId = getTimelineClipCanvasMediaFileId(clip);
  return mediaFileId ? mediaFileStatusById.get(mediaFileId) : undefined;
}

function createTimelineClipCanvasChromeBadge(
  badge: ReturnType<typeof getTimelineClipCanvasPassiveDecorationBadges>[number],
): TimelineClipCanvasChromeBadge {
  return {
    ...badge,
    width: Math.max(14, badge.label.length * 6 + 8),
    right: 4,
  };
}

function createTimelineClipCanvasChromeBadges(
  badges: ReturnType<typeof getTimelineClipCanvasPassiveDecorationBadges>,
): TimelineClipCanvasChromeBadge[] {
  const chromeBadges = badges.map(createTimelineClipCanvasChromeBadge);
  let right = 4;
  for (let index = chromeBadges.length - 1; index >= 0; index -= 1) {
    chromeBadges[index] = { ...chromeBadges[index], right };
    right += chromeBadges[index].width + 3;
  }
  return chromeBadges;
}

export function createTimelineClipCanvasChromeOverlays(input: {
  chromeScrollX: number;
  chromeViewportWidth: number;
  clips: readonly TimelinePaintSourceClip[];
  geometryProps: TimelineClipCanvasGeometryInput;
  mediaFileStatusById: TimelineClipCanvasMediaStatusMap;
  minLabelWidthPx: number;
  thumbnailVisibleClipIds?: ReadonlySet<string>;
  timeToPixel: (time: number) => number;
}): TimelineClipCanvasChromeOverlay[] {
  const overlays: TimelineClipCanvasChromeOverlay[] = [];
  for (const clip of input.clips) {
    const geometry = resolveClipGeometry(clip, input.geometryProps);
    if (!geometry.visible || geometry.duration <= 0) continue;

    const absoluteX = input.timeToPixel(geometry.startTime);
    const absoluteW = input.timeToPixel(geometry.duration);
    const visibleLeft = Math.max(absoluteX, input.chromeScrollX);
    const visibleRight = Math.min(absoluteX + absoluteW, input.chromeScrollX + input.chromeViewportWidth);
    const visibleW = visibleRight - visibleLeft;
    if (visibleW <= 0 || visibleW < input.minLabelWidthPx) continue;

    const passiveBadges = getTimelineClipCanvasPassiveDecorationBadges(
      clip,
      getTimelineClipCanvasMediaStatus(clip, input.mediaFileStatusById),
    );
    overlays.push({
      id: clip.id,
      iconType: clip.isComposition ? 'composition' : clip.source?.type ?? clip.trackType,
      showIcon: !input.thumbnailVisibleClipIds?.has(clip.id),
      label: clip.name,
      left: visibleLeft - input.chromeScrollX,
      width: visibleW,
      badges: createTimelineClipCanvasChromeBadges(passiveBadges),
      badgeReserve: getTimelineClipCanvasPassiveDecorationBadgeReserve(passiveBadges),
    });
  }
  return overlays;
}
