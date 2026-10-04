import { markDynamicCanvasUpdated } from '../canvasVersion';

/**
 * A generated text raster may hold only the pixels its text covers. The frame records
 * the composition-sized raster the canvas stands for: consumers place the canvas at
 * (x, y) inside a frameWidth x frameHeight source instead of stretching it to that size.
 * A canvas without a frame is its own full-size source.
 */
export interface TextCanvasFrame {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly x: number;
  readonly y: number;
}

export interface NormalizedTextureRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// Survives HMR: canvases created before a module reload keep their placement.
const frames: WeakMap<HTMLCanvasElement, TextCanvasFrame> = import.meta.hot?.data?.textCanvasFrames ?? new WeakMap();
if (import.meta.hot?.dispose) import.meta.hot.dispose((data) => { data.textCanvasFrames = frames; });

/** Records that `canvas` holds the (x, y) crop of a frameWidth x frameHeight source. */
export function setTextCanvasFrame(canvas: HTMLCanvasElement, frame: TextCanvasFrame): void {
  frames.set(canvas, Object.freeze({ ...frame }));
}

export function getTextCanvasFrame(canvas: HTMLCanvasElement | null | undefined): TextCanvasFrame | undefined {
  return canvas ? frames.get(canvas) : undefined;
}

/** Marks a canvas as its own full-size source again (it was redrawn uncropped). */
export function clearTextCanvasFrame(canvas: HTMLCanvasElement): void {
  frames.delete(canvas);
}

/** The size of the source a canvas represents (the composition raster for cropped text). */
export function getCanvasSourceSize(canvas: HTMLCanvasElement): { width: number; height: number } {
  const frame = frames.get(canvas);
  return frame
    ? { width: frame.frameWidth, height: frame.frameHeight }
    : { width: canvas.width, height: canvas.height };
}

/** Where the canvas pixels sit inside its source, normalized; undefined for full-size canvases. */
export function getTextCanvasTextureRect(canvas: HTMLCanvasElement): NormalizedTextureRect | undefined {
  const frame = frames.get(canvas);
  if (!frame) return undefined;
  return {
    x: frame.x / frame.frameWidth,
    y: frame.y / frame.frameHeight,
    width: canvas.width / frame.frameWidth,
    height: canvas.height / frame.frameHeight,
  };
}

/** Draws a canvas as its full source into the destination rect, honoring a text crop. */
export function drawCanvasSource(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
): void {
  const frame = frames.get(canvas);
  if (!frame) {
    ctx.drawImage(canvas, dx, dy, dw, dh);
    return;
  }
  if (canvas.width === 0 || canvas.height === 0) return;
  const sx = dw / frame.frameWidth;
  const sy = dh / frame.frameHeight;
  ctx.drawImage(canvas, dx + frame.x * sx, dy + frame.y * sy, canvas.width * sx, canvas.height * sy);
}

const fullFrameCopies = new WeakMap<HTMLCanvasElement, { version: string; canvas: HTMLCanvasElement }>();

/**
 * Full-size pixels for consumers that read the raster directly (3D planes, worker
 * transfers, previews). Returns the canvas itself when it is not cropped; cropped
 * canvases get a cached composition-sized copy that follows the canvas version.
 */
export function getFullFrameCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const frame = frames.get(canvas);
  if (!frame) return canvas;
  const version = `${canvas.dataset.masterselectsVersion ?? '0'}:${frame.x},${frame.y},${canvas.width}x${canvas.height}`;
  const cached = fullFrameCopies.get(canvas);
  if (cached?.version === version) return cached.canvas;
  const copy = cached?.canvas ?? document.createElement('canvas');
  copy.width = frame.frameWidth;
  copy.height = frame.frameHeight;
  const ctx = copy.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, copy.width, copy.height);
    if (canvas.width > 0 && canvas.height > 0) ctx.drawImage(canvas, frame.x, frame.y);
  }
  markDynamicCanvasUpdated(copy, 'text');
  fullFrameCopies.set(canvas, { version, canvas: copy });
  return copy;
}
