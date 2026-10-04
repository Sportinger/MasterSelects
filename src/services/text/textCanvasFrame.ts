import type { TextClipProperties } from '../../types/text';
import { getCanvasContentBounds, setCanvasContentBounds } from '../canvasContentBounds';
import { markDynamicCanvasUpdated } from '../canvasVersion';
import { textRenderer } from '../textRenderer';
import { clearTextCanvasFrame, setTextCanvasFrame } from './textCanvasFrameRegistry';

export {
  clearTextCanvasFrame,
  drawCanvasSource,
  getFullFrameCanvas,
  getCanvasSourceSize,
  getTextCanvasFrame,
  getTextCanvasTextureRect,
} from './textCanvasFrameRegistry';
export type { NormalizedTextureRect, TextCanvasFrame } from './textCanvasFrameRegistry';

// Antialiasing and glyph overhang past the measured bounds stay inside the crop.
const CROP_PADDING = 4;
// Text covering most of the frame gains little from cropping; keep it whole.
const MAX_CROPPED_AREA_RATIO = 0.6;
let scratch: HTMLCanvasElement | null = null;

function getScratchCanvas(width: number, height: number): HTMLCanvasElement {
  scratch ??= document.createElement('canvas');
  if (scratch.width !== width) scratch.width = width;
  if (scratch.height !== height) scratch.height = height;
  return scratch;
}

/**
 * Renders text for a frameWidth x frameHeight source into `canvas`, keeping only the
 * pixels the text covers. Path text and text that fills most of the frame stay
 * full-size because their bounds are not captured or not worth cropping.
 */
export function renderFramedTextCanvas(
  props: TextClipProperties,
  canvas: HTMLCanvasElement,
  frameWidth: number,
  frameHeight: number,
): HTMLCanvasElement {
  const width = Math.max(1, Math.round(frameWidth));
  const height = Math.max(1, Math.round(frameHeight));
  if (props.pathEnabled) {
    clearTextCanvasFrame(canvas);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    return textRenderer.render(props, canvas);
  }

  const source = getScratchCanvas(width, height);
  textRenderer.render(props, source);
  const bounds = getCanvasContentBounds(source);
  const left = bounds ? Math.max(0, Math.floor(bounds.x * width) - CROP_PADDING) : 0;
  const top = bounds ? Math.max(0, Math.floor(bounds.y * height) - CROP_PADDING) : 0;
  const right = bounds ? Math.min(width, Math.ceil((bounds.x + bounds.width) * width) + CROP_PADDING) : 1;
  const bottom = bounds ? Math.min(height, Math.ceil((bounds.y + bounds.height) * height) + CROP_PADDING) : 1;
  const cropWidth = Math.max(1, right - left);
  const cropHeight = Math.max(1, bottom - top);
  const crop = cropWidth * cropHeight <= width * height * MAX_CROPPED_AREA_RATIO;
  const x = crop ? left : 0;
  const y = crop ? top : 0;
  const targetWidth = crop ? cropWidth : width;
  const targetHeight = crop ? cropHeight : height;

  if (canvas.width !== targetWidth) canvas.width = targetWidth;
  if (canvas.height !== targetHeight) canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, targetWidth, targetHeight);
    ctx.drawImage(source, x, y, targetWidth, targetHeight, 0, 0, targetWidth, targetHeight);
  }
  if (crop) setTextCanvasFrame(canvas, { frameWidth: width, frameHeight: height, x, y });
  else clearTextCanvasFrame(canvas);
  setCanvasContentBounds(canvas, bounds);
  markDynamicCanvasUpdated(canvas, 'text');
  return canvas;
}
