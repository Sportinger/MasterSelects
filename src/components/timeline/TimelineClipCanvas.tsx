// TimelineClipCanvas — issue #228, Phase 1 (read-only).
//
// Draws a whole track's clip bodies onto a single <canvas> instead of mounting
// one heavy DOM component per clip. This makes a 100–1000 clip comp render in
// O(visible clips) draw calls with a Level-of-Detail scheme, instead of paying
// React reconciliation + browser layout/paint for hundreds of DOM nodes.
//
// Coordinate space: the canvas lives inside `.track-clip-row` and draws each
// clip at the SAME absolute x as the DOM path (`left = timeToPixel(startTime)`),
// so it inherits the existing horizontal scroll transform automatically — no
// scroll math is duplicated here. At extreme zoom the required canvas width can
// exceed the browser's max canvas size; the caller falls back to the DOM path
// in that case (see MAX_CANVAS_WIDTH_PX).
//
// Phase 1 is intentionally display-only (no hit-testing / handles). Interaction
// stays on the DOM path; Phase 2 adds canvas hit-testing + a single active-clip
// overlay. Thumbnails/waveforms on canvas are a Phase 1 follow-up.

import { memo, useEffect, useRef } from 'react';

// Browser 2D canvas backing-store limit is ~16384px in Chrome; stay safely under.
export const MAX_CANVAS_WIDTH_PX = 16000;

// Level-of-Detail thresholds, in CSS px of clip width.
const LOD_BAR_PX = 4;     // below this: nothing meaningful, draw a thin bar
const LOD_LABEL_PX = 24;  // above this: room for a label

export interface CanvasClip {
  id: string;
  trackId: string;
  startTime: number;
  duration: number;
  name: string;
  source?: { type?: string | null } | null;
}

interface TimelineClipCanvasProps {
  clips: readonly CanvasClip[];
  /** Row height in CSS px (the clip body area). */
  height: number;
  /** Absolute content width in CSS px (max clip end). Caller caps to MAX_CANVAS_WIDTH_PX. */
  contentWidth: number;
  /** Timeline px-per-second → px mapping, identical to the DOM clip path. */
  timeToPixel: (time: number) => number;
  selectedClipIds: ReadonlySet<string>;
  /** Base track color (CSS color string) used for clip fills. */
  trackColor: string;
}

function withAlpha(color: string, alpha: number): string {
  // Accepts #rrggbb or rgb()/hsl(); for hex we build rgba, otherwise wrap.
  if (color.startsWith('#') && (color.length === 7 || color.length === 4)) {
    let r: number, g: number, b: number;
    if (color.length === 4) {
      r = parseInt(color[1] + color[1], 16);
      g = parseInt(color[2] + color[2], 16);
      b = parseInt(color[3] + color[3], 16);
    } else {
      r = parseInt(color.slice(1, 3), 16);
      g = parseInt(color.slice(3, 5), 16);
      b = parseInt(color.slice(5, 7), 16);
    }
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
  }
  return color;
}

function drawClips(
  ctx: CanvasRenderingContext2D,
  props: TimelineClipCanvasProps,
  cssWidth: number,
): void {
  const { clips, height, timeToPixel, selectedClipIds, trackColor } = props;
  ctx.clearRect(0, 0, cssWidth, height);

  const radius = Math.min(4, height / 4);
  const fill = withAlpha(trackColor, 0.55);
  const fillSelected = withAlpha(trackColor, 0.85);
  const border = withAlpha(trackColor, 0.9);
  const selectedBorder = '#ffffff';

  ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textBaseline = 'middle';

  for (const clip of clips) {
    const x = timeToPixel(clip.startTime);
    const w = timeToPixel(clip.duration);
    if (w < LOD_BAR_PX) {
      // Sub-pixel/tiny: a single thin bar, no rounding/label (zoomed-out LOD).
      ctx.fillStyle = selectedClipIds.has(clip.id) ? fillSelected : fill;
      ctx.fillRect(x, 1, Math.max(1, w), height - 2);
      continue;
    }

    const selected = selectedClipIds.has(clip.id);
    const top = 1;
    const h = height - 2;

    // Rounded clip body.
    ctx.beginPath();
    ctx.roundRect(x, top, w, h, radius);
    ctx.fillStyle = selected ? fillSelected : fill;
    ctx.fill();
    ctx.lineWidth = selected ? 2 : 1;
    ctx.strokeStyle = selected ? selectedBorder : border;
    ctx.stroke();

    // Label, only when there is room.
    if (w >= LOD_LABEL_PX && clip.name) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 5, top, w - 10, h);
      ctx.clip();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
      ctx.fillText(clip.name, x + 6, top + h / 2);
      ctx.restore();
    }
  }
}

function TimelineClipCanvasComponent(props: TimelineClipCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef<number | null>(null);
  const { clips, height, contentWidth, timeToPixel, selectedClipIds, trackColor } = props;
  const cssWidth = Math.max(1, Math.min(contentWidth, MAX_CANVAS_WIDTH_PX));

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
    // Backing store at devicePixelRatio for crisp text/edges; CSS size stays logical.
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${height}px`;

    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawClips(ctx, { clips, height, contentWidth, timeToPixel, selectedClipIds, trackColor }, cssWidth);
    });

    return () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // Redraw whenever geometry/selection/color change. timeToPixel identity
    // changes with zoom/scroll, so it captures those without extra deps.
  }, [clips, height, contentWidth, cssWidth, timeToPixel, selectedClipIds, trackColor]);

  return (
    <canvas
      ref={canvasRef}
      className="timeline-clip-canvas"
      style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none' }}
      aria-hidden="true"
    />
  );
}

export const TimelineClipCanvas = memo(TimelineClipCanvasComponent);
