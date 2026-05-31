// OffscreenCanvas worker for the timeline clip layer (issue #228, Phase 4).
//
// Draws clip bodies (rounded rects + Level-of-Detail + labels) entirely off the
// main thread, so even heavy React reconciliation of the timeline chrome cannot
// stutter the clip render. Geometry is linear (x = startTime * pxPerSecond), so
// no transform functions need to cross the worker boundary.
//
// Thumbnails are intentionally not drawn here in this first version: their source
// (thumbnailCacheService) is a main-thread singleton. Sending resolved blob URLs
// per redraw and decoding ImageBitmaps inside the worker is a planned follow-up.

export interface WorkerPlainClip {
  id: string;
  startTime: number;
  duration: number;
  name: string;
}

interface InitMessage {
  type: 'init';
  canvas: OffscreenCanvas;
}

interface DrawMessage {
  type: 'draw';
  clips: WorkerPlainClip[];
  height: number;
  cssWidth: number;
  pxPerSecond: number;
  dpr: number;
  selectedIds: string[];
  excludeIds: string[];
  trackColor: string;
}

type IncomingMessage = InitMessage | DrawMessage;

const LOD_BAR_PX = 4;
const LOD_LABEL_PX = 24;

let canvas: OffscreenCanvas | null = null;
let ctx: OffscreenCanvasRenderingContext2D | null = null;

function withAlpha(color: string, alpha: number): string {
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

function draw(msg: DrawMessage): void {
  if (!canvas || !ctx) return;
  const { clips, height, cssWidth, pxPerSecond, dpr, trackColor } = msg;
  const selected = new Set(msg.selectedIds);
  const excluded = new Set(msg.excludeIds);

  canvas.width = Math.round(cssWidth * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, height);

  const radius = Math.min(4, height / 4);
  const fill = withAlpha(trackColor, 0.55);
  const fillSelected = withAlpha(trackColor, 0.85);
  const border = withAlpha(trackColor, 0.9);

  ctx.font = '11px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif';
  ctx.textBaseline = 'middle';

  for (const clip of clips) {
    if (excluded.has(clip.id)) continue;
    const x = clip.startTime * pxPerSecond;
    const w = clip.duration * pxPerSecond;
    const isSel = selected.has(clip.id);
    if (w < LOD_BAR_PX) {
      ctx.fillStyle = isSel ? fillSelected : fill;
      ctx.fillRect(x, 1, Math.max(1, w), height - 2);
      continue;
    }
    const top = 1;
    const h = height - 2;
    ctx.beginPath();
    ctx.roundRect(x, top, w, h, radius);
    ctx.fillStyle = isSel ? fillSelected : fill;
    ctx.fill();
    ctx.lineWidth = isSel ? 2 : 1;
    ctx.strokeStyle = isSel ? '#ffffff' : border;
    ctx.stroke();
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

self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const msg = event.data;
  if (msg.type === 'init') {
    canvas = msg.canvas;
    ctx = canvas.getContext('2d');
  } else if (msg.type === 'draw') {
    draw(msg);
  }
};
