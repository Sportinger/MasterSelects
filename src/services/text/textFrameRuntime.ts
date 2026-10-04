import type { TimelineClip } from '../../types/timeline';
import type { Keyframe } from '../../types/keyframes';
import type { TextBoundsPath } from '../../types/masks';
import type { TextClipProperties } from '../../types/text';
import { textRenderer } from '../textRenderer';
import { sampleTextProperties } from './textAnimation';
import { formatTextValueTemplate, hasTextValueTokens } from './textValueTemplate';
import { resolveTextClipValue } from './textValueLink';
import { getActiveCompositionFrameRate } from '../../stores/timeline/editOperations/activeCompositionFrameRate';
import { isCssGenericFontFamily } from '../fontFamily';
import { googleFontsService } from '../googleFontsService';
import { clearTextCanvasFrame, getCanvasSourceSize, getTextCanvasFrame, renderFramedTextCanvas } from './textCanvasFrame';

const canvases: WeakMap<HTMLCanvasElement, HTMLCanvasElement> = import.meta.hot?.data?.textFrameCanvases ?? new WeakMap();
const renderedProps: WeakMap<HTMLCanvasElement, { props: TextClipProperties; width: number; height: number }> = import.meta.hot?.data?.textFrameRenderedRasters ?? new WeakMap();
if (import.meta.hot?.dispose) import.meta.hot.dispose(data => {
  data.textFrameCanvases = canvases;
  data.textFrameRenderedRasters = renderedProps;
});

/** Sampled properties keep nested values by identity, so a shallow compare detects held keyframes. */
function sameTextProperties(a: TextClipProperties, b: TextClipProperties): boolean {
  if (a === b) return true;
  const keys = Object.keys(a) as (keyof TextClipProperties)[];
  return keys.length === Object.keys(b).length && keys.every((key) => Object.is(a[key], b[key]));
}

/** A raster drawn with a fallback font must be redrawn once the real font arrives. */
function fontReady(props: TextClipProperties): boolean {
  return isCssGenericFontFamily(props.fontFamily) || googleFontsService.isFontLoaded(props.fontFamily, props.fontWeight);
}

/** Runtime-only canvas; never overwrite a clip's static raster with an animated frame. */
export function renderTextFrame(clip: TimelineClip, keys: readonly Keyframe[], localTime: number, bounds?: TextBoundsPath): HTMLCanvasElement | undefined {
  const source = clip.source?.textCanvas, base = clip.textProperties;
  if (!source || !base || clip.captionProperties || clip.captionLayerBinding) return source;
  const sampled = sampleTextProperties(base, keys, localTime);
  const templated = hasTextValueTokens(base.text);
  if (sampled === base && !bounds && !templated) return source;
  const text = templated ? formatTextValueTemplate(base.text, {
    value: resolveTextClipValue(clip, sampled.value ?? 0, localTime), time: localTime, fps: getActiveCompositionFrameRate(),
  }) : sampled.text;
  const props = text === sampled.text ? sampled : { ...sampled, text };
  const frameProps = bounds ? { ...props, boxEnabled: true, textBounds: bounds } : props;
  // A cropped source (nested text) keeps its animated frames cropped to the same source size.
  const { width, height } = getCanvasSourceSize(source);
  let canvas = canvases.get(source);
  // Held keyframes and unchanged formatted strings: the last raster is still exact.
  const last = canvas ? renderedProps.get(canvas) : undefined;
  if (canvas && last && last.width === width && last.height === height
    && sameTextProperties(last.props, frameProps)) return canvas;
  if (!canvas) { canvas = textRenderer.createCanvas(width, height); canvases.set(source, canvas); }
  if (getTextCanvasFrame(source)) {
    renderFramedTextCanvas(frameProps, canvas, width, height);
  } else {
    clearTextCanvasFrame(canvas);
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    textRenderer.render(frameProps, canvas);
  }
  if (fontReady(frameProps)) renderedProps.set(canvas, { props: frameProps, width, height });
  else renderedProps.delete(canvas);
  return canvas;
}
