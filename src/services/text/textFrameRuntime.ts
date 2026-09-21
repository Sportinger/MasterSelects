import type { TimelineClip } from '../../types/timeline';
import type { Keyframe } from '../../types/keyframes';
import type { TextBoundsPath } from '../../types/masks';
import { textRenderer } from '../textRenderer';
import { sampleTextProperties } from './textAnimation';

const canvases: WeakMap<HTMLCanvasElement, HTMLCanvasElement> = import.meta.hot?.data?.textFrameCanvases ?? new WeakMap();
if (import.meta.hot?.dispose) import.meta.hot.dispose(data => { data.textFrameCanvases = canvases; });

/** Runtime-only canvas; never overwrite a clip's static raster with an animated frame. */
export function renderTextFrame(clip: TimelineClip, keys: readonly Keyframe[], localTime: number, bounds?: TextBoundsPath): HTMLCanvasElement | undefined {
  const source = clip.source?.textCanvas, base = clip.textProperties;
  if (!source || !base || clip.captionProperties || clip.captionLayerBinding) return source;
  const sampled = sampleTextProperties(base, keys, localTime);
  if (sampled === base && !bounds) return source;
  let canvas = canvases.get(source);
  if (!canvas) { canvas = textRenderer.createCanvas(source.width, source.height); canvases.set(source, canvas); }
  if (canvas.width !== source.width) canvas.width = source.width;
  if (canvas.height !== source.height) canvas.height = source.height;
  textRenderer.render(bounds ? { ...sampled, boxEnabled: true, textBounds: bounds } : sampled, canvas);
  return canvas;
}
