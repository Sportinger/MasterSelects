const VIDEO_PREVIEW_HEIGHT_RATIO = 0.75;
const MIN_VIDEO_TITLE_STRIP_HEIGHT_PX = 14;

/** Keep visual previews above a dedicated, readable clip-title color strip. */
export function getTimelineClipCanvasVisualPreviewHeight(bodyHeight: number): number {
  const safeHeight = Number.isFinite(bodyHeight) ? Math.max(0, Math.floor(bodyHeight)) : 0;
  if (safeHeight <= 1) return safeHeight;

  return Math.max(1, Math.min(
    Math.floor(safeHeight * VIDEO_PREVIEW_HEIGHT_RATIO),
    safeHeight - MIN_VIDEO_TITLE_STRIP_HEIGHT_PX,
  ));
}
