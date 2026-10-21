// Is there a green or blue screen at all? Without one the automatic key finds nothing (screen `found` 0) and
// passes the picture through, which only View → Matte would show. The inspector and the effect tools estimate
// `found` with the CPU keyer's own screen measurement on the clip's small timeline thumbnails, so the check needs
// no GPU readback. It sees the source, not the output of effects stacked before the key.
import { chromaKeyCpuScreen, type ChromaKeyCpuSettings } from './keyerCpu';
import type { ChromaKeyScreen } from './keyerContract';

/** Below this screen confidence the key is reported: below 0.05 as no screen, else as a faint one. */
export const CHROMA_KEY_PROBE_WEAK = 0.5;
const PROBE_EDGE = 96, PROBE_IMAGES = 4;
const cache = new Map<string, Promise<number | undefined>>();

async function decodeSmall(url: string): Promise<ImageData | undefined> {
  if (typeof createImageBitmap !== 'function' || typeof fetch !== 'function') return undefined;
  const bitmap = await createImageBitmap(await (await fetch(url)).blob());
  try {
    const scale = Math.min(1, PROBE_EDGE / Math.max(1, bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale)), height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height });
    const context = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!context) return undefined;
    context.drawImage(bitmap, 0, 0, width, height);
    return context.getImageData(0, 0, width, height);
  } finally { bitmap.close(); }
}

function probeImage(url: string, screen: 'green' | 'blue'): Promise<number | undefined> {
  const key = `${screen}|${url}`;
  let known = cache.get(key);
  if (!known) {
    const settings: ChromaKeyCpuSettings = { screen, screenColor: [0, 0, 0], clipBlack: 0, clipWhite: 1, spillSuppression: 0, view: 'result' };
    known = decodeSmall(url).then(image => image && chromaKeyCpuScreen(image.data, settings).found).catch(() => undefined);
    cache.set(key, known);
    if (cache.size > 64) cache.delete(cache.keys().next().value!);
  }
  return known;
}

/** The highest screen confidence (0..1, as the key uses it) over up to four evenly spread images;
 * undefined for a picked colour (the inspector checks the pick itself) or when no image can be read here. */
export async function probeChromaKeyScreen(urls: readonly string[], screen: ChromaKeyScreen): Promise<number | undefined> {
  if (screen === 'custom' || urls.length === 0) return undefined;
  const step = Math.max(1, urls.length / PROBE_IMAGES);
  const picks = [...new Set(Array.from({ length: Math.min(PROBE_IMAGES, urls.length) }, (_value, index) => urls[Math.floor(index * step)]))];
  const found = (await Promise.all(picks.map(url => probeImage(url, screen)))).filter((value): value is number => value !== undefined);
  return found.length ? Math.max(...found) : undefined;
}

/** The inspector and tool message for a probe result, or undefined when the screen is found. */
export function chromaKeyScreenProbeMessage(found: number | undefined, screen: ChromaKeyScreen): string | undefined {
  if (found === undefined || screen === 'custom' || found >= CHROMA_KEY_PROBE_WEAK) return undefined;
  const other = screen === 'green' ? 'Blue' : 'Green';
  return found < 0.05
    ? `No ${screen} screen found in this clip (checked on its thumbnails), so Chroma Key keys nothing. Choose ${other} or Picked color, or check View → Matte.`
    : `Only a faint ${screen} screen found in this clip (checked on its thumbnails), so Chroma Key keys it only partly. Check View → Matte, or pick the screen colour.`;
}
