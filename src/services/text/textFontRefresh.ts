import type { TextClipProperties } from '../../types/text';
import { isCssGenericFontFamily } from '../fontFamily';
import { googleFontsService } from '../googleFontsService';
import { Logger } from '../logger';

const log = Logger.create('TextFontRefresh');

type TextFontProps = Pick<TextClipProperties, 'fontFamily' | 'fontWeight'>;
type Listener = () => void;

interface RefreshRuntime {
  listeners: Set<Listener>;
  pending: WeakMap<HTMLCanvasElement, symbol>;
  failedFonts: Set<string>;
}

const runtime: RefreshRuntime = import.meta.hot?.data?.textFontRefresh ?? {
  listeners: new Set(),
  pending: new WeakMap(),
  failedFonts: new Set(),
};
if (import.meta.hot?.dispose) import.meta.hot.dispose((data) => { data.textFontRefresh = runtime; });

/** True when a raster drawn now uses the real face (system and generic families need no load). */
export function isTextFontReady(props: TextFontProps): boolean {
  return isCssGenericFontFamily(props.fontFamily)
    || googleFontsService.isFontLoaded(props.fontFamily, props.fontWeight)
    || !googleFontsService.isManagedFont(props.fontFamily);
}

/**
 * A text raster drawn before its web font arrived shows the fallback face. Redraw it
 * once the font has loaded and tell the preview, which otherwise stays idle and keeps
 * the fallback (or, on browsers that hide text while a font loads, an empty raster).
 * A later draw of the same canvas replaces the pending redraw.
 */
export function redrawTextWhenFontLoads(
  canvas: HTMLCanvasElement,
  props: TextFontProps,
  redraw: () => void,
): void {
  if (isTextFontReady(props)) {
    runtime.pending.delete(canvas);
    return;
  }
  const token = Symbol('text font refresh');
  runtime.pending.set(canvas, token);
  const fontKey = `${props.fontFamily}-${props.fontWeight}`;
  void googleFontsService.loadFont(props.fontFamily, props.fontWeight).then(() => {
    if (runtime.pending.get(canvas) !== token) return;
    runtime.pending.delete(canvas);
    if (!googleFontsService.isFontLoaded(props.fontFamily, props.fontWeight)) {
      if (!runtime.failedFonts.has(fontKey)) {
        runtime.failedFonts.add(fontKey);
        log.warn('Text font did not load; text keeps the fallback face', { fontFamily: props.fontFamily, fontWeight: props.fontWeight });
      }
      return;
    }
    redraw();
    notifyTextFontRefresh();
  });
}

/** Called after rasters were redrawn with a newly loaded font. */
export function subscribeTextFontRefresh(listener: Listener): () => void {
  runtime.listeners.add(listener);
  return () => { runtime.listeners.delete(listener); };
}

function notifyTextFontRefresh(): void {
  for (const listener of runtime.listeners) {
    try { listener(); }
    catch (error) { log.warn('Text font refresh listener failed', error); }
  }
}
