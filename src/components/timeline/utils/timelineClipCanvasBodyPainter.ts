import type { TimelinePaintSourceClip } from '../../../timeline';
import {
  createStoryboardCardRenderPayload,
  paintStoryboardCardMainThread,
} from '../storyboard';
import { resolveTimelineClipCanvasBodyFill } from './timelineClipCanvasAppearance';

interface TimelineClipCanvasBodyPaintInput {
  ctx: CanvasRenderingContext2D;
  clip: TimelinePaintSourceClip;
  x: number;
  width: number;
  height: number;
  dpr: number;
  fill: string;
  radius?: number;
}

export function paintTimelineClipCanvasBody({
  ctx,
  clip,
  x,
  width,
  height,
  dpr,
  fill,
  radius,
}: TimelineClipCanvasBodyPaintInput): void {
  const card = createStoryboardCardRenderPayload({
    clip,
    x,
    y: 1,
    width,
    height: Math.max(0, height - 2),
    dpr,
  });
  if (radius === undefined) {
    if (card) paintStoryboardCardMainThread(ctx, card);
    else {
      ctx.fillStyle = resolveTimelineClipCanvasBodyFill(clip, fill) ?? fill;
      ctx.fillRect(x, 1, Math.max(1, width), height - 2);
    }
    return;
  }

  ctx.beginPath();
  ctx.roundRect(x, 1, width, height - 2, radius);
  ctx.fillStyle = resolveTimelineClipCanvasBodyFill(clip, fill) ?? fill;
  ctx.fill();
  if (card) paintStoryboardCardMainThread(ctx, card);
}
