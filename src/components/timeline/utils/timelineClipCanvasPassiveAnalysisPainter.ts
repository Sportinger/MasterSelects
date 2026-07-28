import type { TimelinePaintSourceClip } from '../../../timeline';
import { isTimelineClipCanvasAudioClip } from './timelineClipCanvasAudio';
import type { TimelineClipCanvasTrimGeometry } from './timelineClipCanvasTrimResource';
import { getTimelineFaceIdentityColor } from './timelineFaceRangeOverlay';

export function drawTimelineClipCanvasPassiveAnalysisOverlay(
  ctx: CanvasRenderingContext2D,
  clip: TimelinePaintSourceClip,
  geometry: TimelineClipCanvasTrimGeometry,
  x: number,
  top: number,
  w: number,
  h: number,
): void {
  const frames = clip.analysis?.frames;
  if (!frames || frames.length < 2 || w < 24 || isTimelineClipCanvasAudioClip(clip)) return;
  if (clip.analysisStatus !== 'ready' && clip.analysisStatus !== 'analyzing') return;

  const sourceSpan = Math.max(0.001, geometry.outPoint - geometry.inPoint);
  const visibleFrames = frames
    .filter((frame) => frame.timestamp >= geometry.inPoint && frame.timestamp <= geometry.outPoint)
    .toSorted((a, b) => a.timestamp - b.timestamp);
  if (visibleFrames.length < 2) return;

  const maxPoints = Math.max(24, Math.min(320, Math.floor(w / 2)));
  const step = Math.max(1, Math.ceil(visibleFrames.length / maxPoints));
  const sampled = visibleFrames.filter((_, index) => index % step === 0);
  const lastFrame = visibleFrames[visibleFrames.length - 1];
  if (sampled[sampled.length - 1] !== lastFrame) sampled.push(lastFrame);

  const xForTime = (timestamp: number) => {
    const ratio = clip.reversed
      ? (geometry.outPoint - timestamp) / sourceSpan
      : (timestamp - geometry.inPoint) / sourceSpan;
    return x + Math.max(0, Math.min(1, ratio)) * w;
  };
  const graphTop = top + Math.max(12, h * 0.28);
  const graphHeight = Math.max(8, h - (graphTop - top) - 8);
  const yForValue = (value: number, multiplier: number) => {
    const normalized = Math.max(0, Math.min(1, value * multiplier));
    return graphTop + graphHeight - normalized * graphHeight * 0.82;
  };

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const drawSeries = (
    valueForFrame: (frame: (typeof sampled)[number]) => number,
    multiplier: number,
    stroke: string,
    fill: string,
  ) => {
    ctx.beginPath();
    ctx.moveTo(xForTime(sampled[0].timestamp), graphTop + graphHeight);
    for (const frame of sampled) {
      ctx.lineTo(xForTime(frame.timestamp), yForValue(valueForFrame(frame), multiplier));
    }
    ctx.lineTo(xForTime(sampled[sampled.length - 1].timestamp), graphTop + graphHeight);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.beginPath();
    sampled.forEach((frame, index) => {
      const px = xForTime(frame.timestamp);
      const py = yForValue(valueForFrame(frame), multiplier);
      if (index === 0) {
        ctx.moveTo(px, py);
      } else {
        ctx.lineTo(px, py);
      }
    });
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.stroke();
  };

  drawSeries((frame) => frame.focus ?? 0, 1, 'rgba(34, 197, 94, 0.82)', 'rgba(34, 197, 94, 0.12)');
  drawSeries((frame) => frame.globalMotion ?? frame.motion ?? 0, 1.5, 'rgba(59, 130, 246, 0.72)', 'rgba(59, 130, 246, 0.10)');

  for (const frame of sampled) {
    if ((frame.faceCount ?? 0) <= 0) continue;
    const faces = frame.faces;
    if (!faces?.length) {
      ctx.fillStyle = 'rgba(250, 204, 21, 0.82)';
      ctx.beginPath();
      ctx.arc(xForTime(frame.timestamp), top + 7, 2, 0, Math.PI * 2);
      ctx.fill();
      continue;
    }
    faces.filter((face) => face.identityEligible !== false).slice(0, 3).forEach((face, index) => {
      ctx.fillStyle = getTimelineFaceIdentityColor(face.personId).css;
      ctx.beginPath();
      ctx.arc(xForTime(frame.timestamp), top + 7 + index * 4, 2, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  ctx.restore();
}
