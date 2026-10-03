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

const canvases: WeakMap<HTMLCanvasElement, HTMLCanvasElement> = import.meta.hot?.data?.textFrameCanvases ?? new WeakMap();
const renderedProps: WeakMap<HTMLCanvasElement, TextClipProperties> = import.meta.hot?.data?.textFrameRenderedProps ?? new WeakMap();
if (import.meta.hot?.dispose) import.meta.hot.dispose(data => {
  data.textFrameCanvases = canvases;
  data.textFrameRenderedProps = renderedProps;
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
  let canvas = canvases.get(source);
  // Held keyframes and unchanged formatted strings: the last raster is still exact.
  const last = canvas ? renderedProps.get(canvas) : undefined;
  if (canvas && last && sameTextProperties(last, frameProps)
    && canvas.width === source.width && canvas.height === source.height) return canvas;
  if (!canvas) { canvas = textRenderer.createCanvas(source.width, source.height); canvases.set(source, canvas); }
  if (canvas.width !== source.width) canvas.width = source.width;
  if (canvas.height !== source.height) canvas.height = source.height;
  textRenderer.render(frameProps, canvas);
  if (fontReady(frameProps)) renderedProps.set(canvas, frameProps); else renderedProps.delete(canvas);
  return canvas;
}
