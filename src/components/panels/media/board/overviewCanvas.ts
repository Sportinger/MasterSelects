import { getLabelHex } from '../labelColors';
import type { MediaBoardItem, MediaBoardNodePlacement } from './types';

function drawMediaBoardOverviewRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawMediaBoardOverviewImageCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  if (sourceWidth <= 0 || sourceHeight <= 0) return;

  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
}

function getMediaBoardOverviewFill(item: MediaBoardItem): string {
  if (!('type' in item)) return 'rgba(32, 34, 38, 0.9)';
  if (item.type === 'solid' && 'color' in item) return item.color;
  if (item.type === 'composition') return 'rgba(100, 58, 138, 0.82)';
  if (item.type === 'text') return 'rgba(46, 59, 78, 0.92)';
  if (item.type === 'camera') return 'rgba(139, 108, 45, 0.86)';
  if (item.type === 'image') return 'rgba(38, 64, 84, 0.88)';
  if (item.type === 'video') return 'rgba(45, 43, 64, 0.9)';
  if (item.type === 'audio') return 'rgba(52, 71, 55, 0.88)';
  return 'rgba(23, 24, 28, 0.94)';
}

export function drawMediaBoardOverviewItem(
  ctx: CanvasRenderingContext2D,
  placement: MediaBoardNodePlacement,
  image: HTMLImageElement | null,
  zoom: number,
  isDimmed = false,
) {
  const { item, layout } = placement;
  const screenWidth = layout.width * zoom;
  const screenHeight = layout.height * zoom;
  if (screenWidth < 1.2 || screenHeight < 1.2) return;

  ctx.save();
  if (isDimmed) {
    ctx.globalAlpha = 0.24;
  }

  const radius = Math.min(6, Math.max(1.5 / zoom, Math.min(layout.width, layout.height) * 0.06));
  drawMediaBoardOverviewRoundedRect(ctx, layout.x, layout.y, layout.width, layout.height, radius);
  ctx.fillStyle = getMediaBoardOverviewFill(item);
  ctx.fill();

  if (image) {
    ctx.save();
    drawMediaBoardOverviewRoundedRect(ctx, layout.x, layout.y, layout.width, layout.height, radius);
    ctx.clip();
    drawMediaBoardOverviewImageCover(ctx, image, layout.x, layout.y, layout.width, layout.height);
    ctx.restore();
  } else if (screenWidth >= 8 && screenHeight >= 8) {
    const markWidth = Math.max(8 / zoom, layout.width * 0.28);
    const markHeight = Math.max(5 / zoom, layout.height * 0.18);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
    drawMediaBoardOverviewRoundedRect(
      ctx,
      layout.x + (layout.width - markWidth) / 2,
      layout.y + (layout.height - markHeight) / 2,
      markWidth,
      markHeight,
      Math.min(3 / zoom, markHeight / 2),
    );
    ctx.fill();
  }

  const labelHex = 'labelColor' in item ? getLabelHex(item.labelColor) : 'transparent';
  const borderWidth = Math.max(0.75 / zoom, 1);
  ctx.lineWidth = borderWidth;
  ctx.strokeStyle = labelHex === 'transparent' ? 'rgba(255, 255, 255, 0.1)' : labelHex;
  drawMediaBoardOverviewRoundedRect(
    ctx,
    layout.x + borderWidth / 2,
    layout.y + borderWidth / 2,
    Math.max(0, layout.width - borderWidth),
    Math.max(0, layout.height - borderWidth),
    radius,
  );
  ctx.stroke();
  ctx.restore();
}
