import type { TimelineClip } from '../../types/timeline';
import type { Keyframe } from '../../types/keyframes';
import type { TextBoundsPath } from '../../types/masks';
import type { TextClipProperties } from '../../types/text';
import { textRenderer } from '../textRenderer';
import { sampleTextProperties } from './textAnimation';
import { formatTextValueTemplate, hasTextValueTokens } from './textValueTemplate';
import { resolveTextClipValue } from './textValueLink';

const canvases: WeakMap<HTMLCanvasElement, HTMLCanvasElement> = import.meta.hot?.data?.textFrameCanvases ?? new WeakMap();
const renderedTemplateText: WeakMap<HTMLCanvasElement, { base: TextClipProperties; text: string }> = import.meta.hot?.data?.textFrameTemplateText ?? new WeakMap();
if (import.meta.hot?.dispose) import.meta.hot.dispose(data => {
  data.textFrameCanvases = canvases;
  data.textFrameTemplateText = renderedTemplateText;
});

/** Runtime-only canvas; never overwrite a clip's static raster with an animated frame. */
export function renderTextFrame(clip: TimelineClip, keys: readonly Keyframe[], localTime: number, bounds?: TextBoundsPath): HTMLCanvasElement | undefined {
  const source = clip.source?.textCanvas, base = clip.textProperties;
  if (!source || !base || clip.captionProperties || clip.captionLayerBinding) return source;
  const sampled = sampleTextProperties(base, keys, localTime);
  const templated = hasTextValueTokens(base.text);
  if (sampled === base && !bounds && !templated) return source;
  const text = templated ? formatTextValueTemplate(base.text, {
    value: resolveTextClipValue(clip, sampled.value ?? 0, localTime), time: localTime,
  }) : sampled.text;
  let canvas = canvases.get(source);
  // Static style + unchanged formatted string: the last raster is still exact.
  const reusable = sampled === base && !bounds;
  if (canvas && reusable && renderedTemplateText.get(canvas)?.base === base && renderedTemplateText.get(canvas)?.text === text
    && canvas.width === source.width && canvas.height === source.height) return canvas;
  if (!canvas) { canvas = textRenderer.createCanvas(source.width, source.height); canvases.set(source, canvas); }
  if (canvas.width !== source.width) canvas.width = source.width;
  if (canvas.height !== source.height) canvas.height = source.height;
  const props = text === sampled.text ? sampled : { ...sampled, text };
  textRenderer.render(bounds ? { ...props, boxEnabled: true, textBounds: bounds } : props, canvas);
  if (reusable) renderedTemplateText.set(canvas, { base, text }); else renderedTemplateText.delete(canvas);
  return canvas;
}
