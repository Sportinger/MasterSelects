import type { StoryboardCardRenderPayload } from './storyboardCardRenderPayload';

export type StoryboardCardCanvasContext = Pick<
  CanvasRenderingContext2D,
  | 'beginPath'
  | 'clip'
  | 'fill'
  | 'fillRect'
  | 'fillStyle'
  | 'fillText'
  | 'font'
  | 'lineWidth'
  | 'roundRect'
  | 'save'
  | 'restore'
  | 'stroke'
  | 'strokeStyle'
  | 'textBaseline'
>;

function paintTextLines(
  context: StoryboardCardCanvasContext,
  lines: readonly string[],
  x: number,
  startY: number,
  lineHeight: number,
): number {
  let y = startY;
  for (const line of lines) {
    context.fillText(line, x, y);
    y += lineHeight;
  }
  return y;
}

/** Pure payload consumer shared by both main-thread and worker adapters. */
export function paintStoryboardCardRenderPayload(
  context: StoryboardCardCanvasContext,
  payload: StoryboardCardRenderPayload,
): void {
  const { x, y, width, height } = payload;
  if (width <= 0 || height <= 0) return;
  if (payload.density === 'bar') {
    context.fillStyle = payload.backgroundColor;
    context.fillRect(x, y, Math.max(1, width), height);
    return;
  }

  const radius = Math.min(5, height / 4);
  context.save();
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.fillStyle = payload.backgroundColor;
  context.fill();
  context.clip();
  context.textBaseline = 'top';

  let textY = y + 6;
  context.fillStyle = payload.titleColor;
  context.font = `700 ${payload.titleFontSize}px ${payload.fontFamily}`;
  textY = paintTextLines(context, payload.titleLines, x + 8, textY, payload.titleFontSize + 2);

  if (payload.descriptionLines.length > 0) {
    textY += 2;
    context.fillStyle = payload.secondaryTextColor;
    context.font = `400 ${payload.bodyFontSize}px ${payload.fontFamily}`;
    paintTextLines(context, payload.descriptionLines, x + 8, textY, payload.bodyFontSize + 3);
  }

  if (payload.density === 'full') {
    context.fillStyle = payload.secondaryTextColor;
    context.font = `600 9px ${payload.fontFamily}`;
    context.fillText(payload.statusLabel.toUpperCase(), x + 8, y + height - 15);
    context.fillText(payload.durationLabel, Math.max(x + 8, x + width - 76), y + height - 15);
    if (payload.badgeLabels.length > 0 && width >= 240) {
      context.fillText(payload.badgeLabels.slice(0, 2).join(' · '), x + 78, y + height - 15);
    }
  }
  context.restore();

  context.beginPath();
  context.roundRect(x, y, width, height, radius);
  context.lineWidth = 1;
  context.strokeStyle = payload.borderColor;
  context.stroke();
}
