import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getEffect } from '../../../effects';
import { createLookPlaceholder } from '../../../effects/looks/lookPlaceholder';
import { lookPreviewScheduler } from '../../../effects/looks/lookPreviewScheduler';
import { lookThumbnailRuntime } from '../../../effects/looks/lookThumbnailRuntime';
import type { LookDefinition } from '../../../effects/looks/types';
import { Logger } from '../../../services/logger';
import './LookTile.css';

const HOVER_FRAME_MS = 1_000 / 12;
const HOVER_DURATION_MS = 2_000;
let activeHoverStop: (() => void) | null = null;
const log = Logger.create('LookTile');

interface LookTileProps {
  look: LookDefinition;
  sourceFrameId: string;
  onApply: () => void;
  onDelete?: () => void;
}

export function LookTile({ look, sourceFrameId, onApply, onDelete }: LookTileProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hoverStopRef = useRef<(() => void) | null>(null);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<number | null>(null);
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined');
  const [readyKey, setReadyKey] = useState('');
  const [renderNonce, setRenderNonce] = useState(0);
  const placeholder = useMemo(() => createLookPlaceholder(look.id, look.name), [look.id, look.name]);
  const stackHash = useMemo(() => JSON.stringify(look.stack), [look.stack]);
  const cacheKey = `${sourceFrameId}:${look.id}:${stackHash}`;
  const ready = readyKey === cacheKey;
  const animated = look.stack.some((entry) => getEffect(entry.effectId)?.requiresContinuousRender === true);

  const draw = useCallback((bitmap: ImageBitmap | null) => {
    if (!bitmap || bitmap.width === 0 || bitmap.height === 0 || !canvasRef.current) return false;
    const context = canvasRef.current.getContext('2d');
    if (!context) return false;
    context.clearRect(0, 0, 256, 144);
    context.drawImage(bitmap, 0, 0, 256, 144);
    setReadyKey(cacheKey);
    return true;
  }, [cacheKey]);

  useEffect(() => {
    const node = rootRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const frame = requestAnimationFrame(() => {
      const bounds = node.getBoundingClientRect();
      setVisible(
        bounds.bottom >= -100
        && bounds.right >= -100
        && bounds.top <= window.innerHeight + 100
        && bounds.left <= window.innerWidth + 100,
      );
    });
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: '100px' });
    observer.observe(node);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    retryCountRef.current = 0;
  }, [cacheKey]);

  useEffect(() => {
    if (!visible) return;
    if (retryTimerRef.current !== null) {
      window.clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    let cancelled = false;
    let frame: number | null = null;
    const jobKey = `static:${cacheKey}`;
    const enqueue = () => lookPreviewScheduler.enqueue(jobKey, async () => {
      if (cancelled) return;
      try {
        const bitmap = await lookThumbnailRuntime.renderLook(look, sourceFrameId, cacheKey);
        if (cancelled) return;
        if (!draw(bitmap) && retryCountRef.current < 3) {
          retryCountRef.current += 1;
          retryTimerRef.current = window.setTimeout(() => {
            retryTimerRef.current = null;
            if (!cancelled) setRenderNonce((value) => value + 1);
          }, 1_000);
        }
      } catch (error) {
        if (!cancelled) log.error(`Failed to render look preview: ${look.id}`, error);
      }
    });
    if (lookThumbnailRuntime.getCached(cacheKey)) {
      frame = requestAnimationFrame(() => {
        if (cancelled) return;
        // Cache ownership stays with the runtime; a source change can close
        // the previously cached bitmap before this animation frame executes.
        if (!draw(lookThumbnailRuntime.getCached(cacheKey))) enqueue();
      });
    } else {
      enqueue();
    }
    return () => {
      cancelled = true;
      if (frame !== null) cancelAnimationFrame(frame);
      lookPreviewScheduler.cancel(jobKey);
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
  }, [cacheKey, draw, look, renderNonce, sourceFrameId, visible]);

  useEffect(() => {
    const retryWhenForegrounded = () => {
      if (document.visibilityState !== 'hidden') {
        retryCountRef.current = 0;
        setRenderNonce((value) => value + 1);
      }
    };
    window.addEventListener('focus', retryWhenForegrounded);
    document.addEventListener('visibilitychange', retryWhenForegrounded);
    return () => {
      window.removeEventListener('focus', retryWhenForegrounded);
      document.removeEventListener('visibilitychange', retryWhenForegrounded);
    };
  }, []);

  useEffect(() => () => {
    hoverStopRef.current?.();
    if (retryTimerRef.current !== null) window.clearTimeout(retryTimerRef.current);
  }, [cacheKey]);

  const stopHover = () => {
    hoverStopRef.current?.();
    hoverStopRef.current = null;
    if (activeHoverStop === stopHover) activeHoverStop = null;
    draw(lookThumbnailRuntime.getCached(cacheKey));
  };

  const startHover = () => {
    void lookThumbnailRuntime.prewarm(look);
    if (!animated || !visible) return;
    activeHoverStop?.();
    let cancelled = false;
    let lastFrame = 0;
    const startedAt = performance.now();
    const tick = (now: number) => {
      if (cancelled || now - startedAt > HOVER_DURATION_MS) return;
      if (now - lastFrame >= HOVER_FRAME_MS) {
        lastFrame = now;
        void lookThumbnailRuntime.renderLook(look, sourceFrameId, `${cacheKey}:hover:${Math.floor(now)}`, false).then((bitmap) => {
          if (!cancelled) draw(bitmap);
          bitmap?.close();
        });
      }
      requestAnimationFrame(tick);
    };
    hoverStopRef.current = () => { cancelled = true; };
    activeHoverStop = stopHover;
    requestAnimationFrame(tick);
  };

  return (
    <article
      className="look-tile"
      ref={rootRef}
      onPointerEnter={startHover}
      onPointerLeave={stopHover}
      onFocus={startHover}
      onBlur={stopHover}
    >
      <button
        aria-label={`Apply ${look.name} from thumbnail`}
        className="look-tile-preview"
        onClick={onApply}
        style={{ background: placeholder.background }}
        title={`Apply ${look.name}`}
        type="button"
      >
        <span className="look-tile-initials">{placeholder.initials}</span>
        <canvas className={ready ? 'is-ready' : ''} ref={canvasRef} width={256} height={144} />
      </button>
      <div className="look-tile-footer">
        <button type="button" className="look-tile-apply" onClick={onApply} title={`Apply ${look.name}`}>
          {look.name}
        </button>
        {onDelete && <button type="button" className="look-tile-delete" onClick={onDelete} title="Delete custom look">×</button>}
      </div>
    </article>
  );
}
