// The picture of an Effects or Filters card: the effect or Look rendered on the sheet's preview
// source (usePhonePreviewSource) through the desktop thumbnail runtime and its scheduler, the same
// renderer as LookTile, no second one. Rendered lazily (only cards near the visible part of the sheet),
// cached by the runtime per source, a calm placeholder while it renders, and an honest "No preview"
// when the GPU cannot render it (after two retries; tapping the card still works).

import { useEffect, useMemo, useRef, useState } from 'react';

import { createLookPlaceholder } from '../../../effects/looks/lookPlaceholder';
import { lookPreviewScheduler } from '../../../effects/looks/lookPreviewScheduler';
import { lookThumbnailRuntime } from '../../../effects/looks/lookThumbnailRuntime';
import { LOOK_THUMBNAIL_HEIGHT, LOOK_THUMBNAIL_WIDTH } from '../../../effects/looks/lookThumbnailViews';
import type { LookDefinition } from '../../../effects/looks/types';
import { Logger } from '../../../services/logger';
import { PHONE_EFFECTS_TEST_IDS as IDS } from './phoneEffectsTestIds';

const log = Logger.create('PhoneEffectThumb');
const RETRIES = 2;
const RETRY_MS = 1_000;

export type PhoneThumbState = 'idle' | 'loading' | 'ready' | 'unchanged' | 'failed';

interface PhoneEffectThumbProps {
  look: LookDefinition;
  sourceId: string;
  /** The unprocessed picture (Filters' None card): never marked "No visible change". */
  original?: boolean;
  /** The card renders a fixed demonstrative strength, not the defaults (phoneEffectPreviewParams.ts). */
  demo?: boolean;
}

export function PhoneEffectThumb({ look, sourceId, original = false, demo = false }: PhoneEffectThumbProps) {
  const rootRef = useRef<HTMLSpanElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  // Results and retries belong to one cache key: a new source or look starts over without a reset effect.
  const [result, setResult] = useState<{ key: string; state: 'ready' | 'unchanged' | 'failed' } | null>(null);
  const [retry, setRetry] = useState({ key: '', count: 0 });
  const placeholder = useMemo(() => createLookPlaceholder(look.id, look.name), [look.id, look.name]);
  const stackHash = useMemo(() => JSON.stringify(look.stack), [look.stack]);
  const cacheKey = `${sourceId}:${look.id}:${stackHash}`;
  const attempt = retry.key === cacheKey ? retry.count : 0;
  const state: PhoneThumbState = result?.key === cacheKey ? result.state : visible ? 'loading' : 'idle';

  // Lazy: only cards within a screen of the visible part of the scrolling sheet render.
  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '200px 0px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let retryTimer: number | null = null;
    const draw = (bitmap: ImageBitmap | null): boolean => {
      const context = canvasRef.current?.getContext('2d');
      if (!bitmap || bitmap.width === 0 || !context) return false;
      context.clearRect(0, 0, LOOK_THUMBNAIL_WIDTH, LOOK_THUMBNAIL_HEIGHT);
      context.drawImage(bitmap, 0, 0, LOOK_THUMBNAIL_WIDTH, LOOK_THUMBNAIL_HEIGHT);
      setResult({ key: cacheKey, state: !original && lookThumbnailRuntime.getPreviewInfo(cacheKey)?.unchanged ? 'unchanged' : 'ready' });
      return true;
    };
    // The runtime owns its cached bitmaps (a source change closes them), so draw straight away.
    if (draw(lookThumbnailRuntime.getCached(cacheKey))) return;
    const jobKey = `phone:${cacheKey}`;
    lookPreviewScheduler.enqueue(jobKey, async () => {
      if (cancelled) return;
      try {
        const bitmap = await lookThumbnailRuntime.renderLook(look, sourceId, cacheKey);
        if (cancelled || draw(bitmap)) return;
      } catch (error) {
        log.warn(`Card preview failed: ${look.id}`, error);
      }
      if (cancelled) return;
      if (attempt < RETRIES) {
        retryTimer = window.setTimeout(() => { if (!cancelled) setRetry({ key: cacheKey, count: attempt + 1 }); }, RETRY_MS);
      } else {
        log.warn(`No card preview for ${look.id}: the thumbnail runtime could not render it (GPU not ready).`);
        setResult({ key: cacheKey, state: 'failed' });
      }
    });
    return () => {
      cancelled = true;
      lookPreviewScheduler.cancel(jobKey);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [attempt, cacheKey, look, original, sourceId, visible]);

  const shown = state === 'ready' || state === 'unchanged';
  return (
    <span
      ref={rootRef}
      className="phone-fx__thumb"
      data-testid={IDS.cardPreview}
      data-preview-state={state}
      data-preview-demo={demo || undefined}
      style={{ background: placeholder.background }}
      aria-hidden="true"
    >
      <canvas
        ref={canvasRef}
        className={shown ? 'is-ready' : undefined}
        width={LOOK_THUMBNAIL_WIDTH}
        height={LOOK_THUMBNAIL_HEIGHT}
      />
      {state === 'unchanged' && <span className="phone-fx__thumb-note">No visible change</span>}
      {state === 'failed' && <span className="phone-fx__thumb-note">No preview</span>}
    </span>
  );
}
