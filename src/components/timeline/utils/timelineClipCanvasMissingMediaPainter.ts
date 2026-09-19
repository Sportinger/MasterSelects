import {
  TIMELINE_MISSING_MEDIA_BORDER,
  TIMELINE_MISSING_MEDIA_TINT,
} from './timelineClipCanvasAppearance';

interface MissingMediaBorderInput {
  ctx: CanvasRenderingContext2D;
  needsReload: boolean;
  selected: boolean;
  hovered: boolean;
  x: number;
  top: number;
  width: number;
  height: number;
  radius: number;
  border: string;
  selectedBorder: string;
}

export function paintTimelineClipCanvasMissingMediaBorder(input: MissingMediaBorderInput): void {
  const { ctx, needsReload, selected, hovered, x, top, width, height, radius } = input;
  if (needsReload) {
    ctx.beginPath();
    ctx.roundRect(x, top, width, height, radius);
    ctx.fillStyle = TIMELINE_MISSING_MEDIA_TINT;
    ctx.fill();
  }

  ctx.beginPath();
  ctx.roundRect(x, top, width, height, radius);
  ctx.lineWidth = selected ? 2 : hovered ? 1.5 : 1;
  ctx.strokeStyle = selected
    ? input.selectedBorder
    : needsReload
      ? TIMELINE_MISSING_MEDIA_BORDER
      : hovered
        ? 'rgba(255,255,255,0.58)'
        : input.border;
  ctx.stroke();
}
