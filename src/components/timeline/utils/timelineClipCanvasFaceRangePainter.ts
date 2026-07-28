import type { TimelinePaintSourceClip } from '../../../timeline';
import {
  collectTimelineFaceIdentityRanges,
  getTimelineFaceIdentityColor,
  getTimelineFaceIdentityRangeRatios,
} from './timelineFaceRangeOverlay';
import type { TimelineClipCanvasTrimGeometry } from './timelineClipCanvasTrimResource';

export function drawTimelineClipCanvasFaceRanges(
  ctx: CanvasRenderingContext2D,
  clip: TimelinePaintSourceClip,
  geometry: TimelineClipCanvasTrimGeometry,
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  if (w < 12) return;
  const ratios = getTimelineFaceIdentityRangeRatios(
    collectTimelineFaceIdentityRanges(clip),
    geometry.inPoint,
    geometry.outPoint,
    clip.reversed,
  );
  if (ratios.length === 0) return;

  const bandHeight = Math.max(2, Math.min(4, h * 0.12));
  for (const range of ratios) {
    const [red, green, blue] = getTimelineFaceIdentityColor(range.personId).rgb;
    const left = x + range.start * w;
    const width = Math.max(1, (range.end - range.start) * w);
    ctx.fillStyle = `rgba(${red}, ${green}, ${blue}, 0.16)`;
    ctx.fillRect(left, top, width, h);
    ctx.fillStyle = `rgba(${red}, ${green}, ${blue}, 0.78)`;
    ctx.fillRect(left, top + h - bandHeight, width, bandHeight);
  }
}
