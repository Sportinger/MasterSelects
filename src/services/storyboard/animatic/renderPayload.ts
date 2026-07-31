import type { StoryboardAnimaticFramePayload } from './types';

export type StoryboardAnimaticCanvasContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

function imageDimension(
  image: CanvasImageSource,
  keys: readonly string[],
  fallback: number,
): number {
  const record = image as unknown as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  }
  return fallback;
}

function roundedRect(
  context: StoryboardAnimaticCanvasContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function fitText(
  context: StoryboardAnimaticCanvasContext,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const words = text.trim().split(/\s+/u).filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (context.measureText(next).width <= maxWidth || !current) {
      current = next;
    } else {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) break;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) {
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.…]+$/u, '')}…`;
  }
  return lines;
}

function drawWatermark(
  context: StoryboardAnimaticCanvasContext,
  payload: StoryboardAnimaticFramePayload,
): void {
  if (!payload.watermark) return;
  context.save();
  context.fillStyle = 'rgba(0, 0, 0, 0.58)';
  context.font = `600 ${Math.max(12, Math.round(payload.height * 0.022))}px system-ui, sans-serif`;
  const width = context.measureText(payload.watermark).width + 30;
  roundedRect(context, payload.width - width - 20, 20, width, 36, 8);
  context.fill();
  context.fillStyle = '#ffffff';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(payload.watermark, payload.width - width / 2 - 20, 38);
  context.restore();
}

export function paintStoryboardAnimaticFramePayload(
  context: StoryboardAnimaticCanvasContext,
  payload: StoryboardAnimaticFramePayload,
  image?: CanvasImageSource,
): void {
  const { width, height } = payload;
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);

  if (payload.kind === 'still-image' && payload.still && image) {
    context.fillStyle = '#09090b';
    context.fillRect(0, 0, width, height);
    const sourceWidth = imageDimension(image, ['videoWidth', 'displayWidth', 'width'], width);
    const sourceHeight = imageDimension(image, ['videoHeight', 'displayHeight', 'height'], height);
    const coverScale = Math.max(width / sourceWidth, height / sourceHeight) * payload.still.scale;
    const drawWidth = sourceWidth * coverScale;
    const drawHeight = sourceHeight * coverScale;
    context.drawImage(
      image,
      (width - drawWidth) / 2,
      (height - drawHeight) / 2,
      drawWidth,
      drawHeight,
    );
  } else if (payload.kind === 'slate' && payload.slate) {
    const slate = payload.slate;
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#111827');
    gradient.addColorStop(1, '#09090b');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);

    context.fillStyle = slate.accentColor;
    context.fillRect(0, 0, Math.max(8, width * 0.012), height);

    const left = width * 0.09;
    const contentWidth = width * 0.82;
    context.textAlign = 'left';
    context.textBaseline = 'top';
    context.fillStyle = '#a1a1aa';
    context.font = `600 ${Math.max(14, Math.round(height * 0.025))}px system-ui, sans-serif`;
    context.fillText(`SCENE SLATE · ${slate.status.toUpperCase()}`, left, height * 0.16);

    context.fillStyle = '#ffffff';
    context.font = `700 ${Math.max(30, Math.round(height * 0.075))}px system-ui, sans-serif`;
    const titleLines = fitText(context, slate.title, contentWidth, 2);
    titleLines.forEach((line, index) => context.fillText(line, left, height * 0.25 + index * height * 0.09));

    context.fillStyle = '#d4d4d8';
    context.font = `400 ${Math.max(17, Math.round(height * 0.035))}px system-ui, sans-serif`;
    const descriptionLines = fitText(context, slate.description, contentWidth, 4);
    descriptionLines.forEach((line, index) => context.fillText(line, left, height * 0.49 + index * height * 0.055));

    context.fillStyle = '#a1a1aa';
    context.font = `500 ${Math.max(14, Math.round(height * 0.026))}px ui-monospace, monospace`;
    context.fillText(
      `TARGET ${slate.targetDurationSeconds.toFixed(1)}s  ·  ${payload.progress === 1 ? 'END' : `${Math.round(payload.progress * 100)}%`}`,
      left,
      height * 0.82,
    );
  }

  drawWatermark(context, payload);
  context.restore();
}
