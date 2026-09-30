interface CompositionOutlineInput {
  ctx: CanvasRenderingContext2D;
  x: number;
  top: number;
  width: number;
  height: number;
  visibleLeft: number;
  visibleRight: number;
}

/** Clip before tessellating dashes: canvas clipping alone still expands the full path. */
export function drawTimelineClipCanvasCompositionOutline({
  ctx, x, top, width, height, visibleLeft, visibleRight,
}: CompositionOutlineInput): void {
  if (width < 2 || height < 2) return;
  const left = x + 1;
  const right = x + width - 1;
  if (right < visibleLeft || left > visibleRight) return;
  const upper = top + 1;
  const lower = top + height - 1;
  const radius = Math.min(4, height / 4, (right - left) / 2, (lower - upper) / 2);
  const start = Math.max(left + radius, visibleLeft);
  const end = Math.min(right - radius, visibleRight);

  ctx.save();
  ctx.strokeStyle = 'rgba(251, 146, 60, 0.9)';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  if (end > start) {
    // Anchor dashes in clip coordinates, so panning does not shift the pattern.
    ctx.lineDashOffset = -((start - left - radius) % 10);
    ctx.beginPath();
    ctx.moveTo(start, upper);
    ctx.lineTo(end, upper);
    ctx.moveTo(start, lower);
    ctx.lineTo(end, lower);
    ctx.stroke();
  }

  // Keep real rounded clip edges; never invent a border at a viewport boundary.
  ctx.lineDashOffset = 0;
  if (left + radius >= visibleLeft && left <= visibleRight) {
    ctx.beginPath();
    ctx.moveTo(left + radius, upper);
    ctx.arcTo(left, upper, left, upper + radius, radius);
    ctx.lineTo(left, lower - radius);
    ctx.arcTo(left, lower, left + radius, lower, radius);
    ctx.stroke();
  }
  if (right >= visibleLeft && right - radius <= visibleRight) {
    ctx.beginPath();
    ctx.moveTo(right - radius, upper);
    ctx.arcTo(right, upper, right, upper + radius, radius);
    ctx.lineTo(right, lower - radius);
    ctx.arcTo(right, lower, right - radius, lower, radius);
    ctx.stroke();
  }
  ctx.restore();
}
