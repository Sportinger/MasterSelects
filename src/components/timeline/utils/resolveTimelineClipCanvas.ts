export const RESOLVE_TIMELINE_CLIP_FOOTER_HEIGHT_PX = 17;
export const RESOLVE_TIMELINE_CLIP_PREVIEW_INSET_PX = 2;

interface ResolveTimelineClipFooterContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  fillRect: (x: number, y: number, width: number, height: number) => void;
  beginPath: () => void;
  moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void;
  stroke: () => void;
}

export function getResolveTimelineClipFooterHeight(bodyHeight: number): number {
  return Math.min(
    RESOLVE_TIMELINE_CLIP_FOOTER_HEIGHT_PX,
    Math.max(0, Math.floor(bodyHeight) - 8),
  );
}

export function paintResolveTimelineClipFooter(
  context: ResolveTimelineClipFooterContext,
  x: number,
  top: number,
  width: number,
  height: number,
  fill: string,
): void {
  if (width <= 0 || height <= 0) return;
  context.fillStyle = fill;
  context.fillRect(x, top, width, height);
  context.beginPath();
  context.moveTo(x, top + 0.5);
  context.lineTo(x + width, top + 0.5);
  context.lineWidth = 1;
  context.strokeStyle = 'rgba(0, 0, 0, 0.48)';
  context.stroke();
}

export function paintResolveTimelineClipPreviewBackground(
  context: ResolveTimelineClipFooterContext,
  x: number,
  top: number,
  width: number,
  previewHeight: number,
): void {
  context.fillStyle = '#111114';
  context.fillRect(x + 1, top + 1, Math.max(1, width - 2), Math.max(1, previewHeight - 2));
}

export function paintResolveTimelineClipFooterForBody(
  context: ResolveTimelineClipFooterContext,
  x: number,
  top: number,
  width: number,
  height: number,
  footerHeight: number,
  fill: string,
): void {
  if (footerHeight <= 0) return;
  paintResolveTimelineClipFooter(
    context,
    x,
    top + height - footerHeight,
    width,
    footerHeight,
    fill,
  );
}
