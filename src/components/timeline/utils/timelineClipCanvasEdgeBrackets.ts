type TimelineClipCanvasContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

const EDGE_INSET_PX = 1;
const MAX_CAP_LENGTH_PX = 18;
const EDGE_COLOR = 'rgba(255, 255, 255, 0.82)';
const CAP_COLOR = 'rgba(255, 255, 255, 0.74)';
const CAP_FADE = 'rgba(255, 255, 255, 0)';

/**
 * Draws persistent clip-edge brackets. Adjacent clips read as `][`, while the
 * short top/bottom caps fade inward and leave thumbnails and waveforms clear.
 */
export function drawTimelineClipCanvasEdgeBrackets(
  context: TimelineClipCanvasContext,
  x: number,
  top: number,
  width: number,
  height: number,
): void {
  if (width <= EDGE_INSET_PX * 2 || height <= 2) return;

  const left = x + EDGE_INSET_PX;
  const right = x + width - EDGE_INSET_PX;
  const topY = top + 0.5;
  const bottomY = top + height - 0.5;
  const capLength = Math.min(MAX_CAP_LENGTH_PX, width / 2);

  context.save();
  context.lineWidth = 1;
  context.lineCap = 'butt';

  context.strokeStyle = EDGE_COLOR;
  context.beginPath();
  context.moveTo(left, topY);
  context.lineTo(left, bottomY);
  context.moveTo(right, topY);
  context.lineTo(right, bottomY);
  context.stroke();

  const leftFade = context.createLinearGradient(left, 0, left + capLength, 0);
  leftFade.addColorStop(0, CAP_COLOR);
  leftFade.addColorStop(1, CAP_FADE);
  context.strokeStyle = leftFade;
  context.beginPath();
  context.moveTo(left, topY);
  context.lineTo(left + capLength, topY);
  context.moveTo(left, bottomY);
  context.lineTo(left + capLength, bottomY);
  context.stroke();

  const rightFade = context.createLinearGradient(right - capLength, 0, right, 0);
  rightFade.addColorStop(0, CAP_FADE);
  rightFade.addColorStop(1, CAP_COLOR);
  context.strokeStyle = rightFade;
  context.beginPath();
  context.moveTo(right - capLength, topY);
  context.lineTo(right, topY);
  context.moveTo(right - capLength, bottomY);
  context.lineTo(right, bottomY);
  context.stroke();

  context.restore();
}
