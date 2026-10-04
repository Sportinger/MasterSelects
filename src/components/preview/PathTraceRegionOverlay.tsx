// Render region of the path tracer: drawn by dragging over the preview after the toolbar's Region
// button; the still image accumulates only inside it (outside, the realtime image stays).

import type React from 'react';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useMediaStore } from '../../stores/mediaStore';
import { normalizeCompositionRenderSettings } from '../../engine/native3d/pathtrace/contracts/ptTypes';
import { updateCompositionRenderSettings } from './compositionRenderSettings';
import './PathTraceRegionOverlay.css';

let drawing = false;
const listeners = new Set<() => void>();

/** Whether the next drag over the preview draws the render region. */
export function setPtRegionDrawing(on: boolean): void {
  drawing = on;
  listeners.forEach(listener => listener());
}

export function usePtRegionDrawing(): boolean {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; }, () => drawing);
}

interface Rect { x: number; y: number; width: number; height: number }

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function PathTraceRegionOverlay({ compositionId, canvasInContainer }: {
  compositionId: string | null;
  canvasInContainer: { x: number; y: number; width: number; height: number };
}) {
  const active = usePtRegionDrawing();
  const stored = useMediaStore(state => state.compositions.find(item => item.id === compositionId)?.renderSettings);
  const settings = normalizeCompositionRenderSettings(stored);
  const [draft, setDraft] = useState<Rect | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (!active) return undefined;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { setDraft(null); setPtRegionDrawing(false); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active]);

  if (!compositionId || settings.engine !== 'path-traced' || (!active && !settings.region)) return null;
  const toNormalized = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    return { x: clamp01((event.clientX - box.left) / box.width), y: clamp01((event.clientY - box.top) / box.height) };
  };
  const rectFrom = (a: { x: number; y: number }, b: { x: number; y: number }): Rect =>
    ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) });
  const shown = draft ?? (active ? null : settings.region ?? null);
  return (
    <div
      className={`pt-region-overlay ${active ? 'drawing' : ''}`}
      style={{ left: canvasInContainer.x, top: canvasInContainer.y, width: canvasInContainer.width, height: canvasInContainer.height }}
      onPointerDown={active ? (event) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = toNormalized(event);
        setDraft({ ...start.current, width: 0, height: 0 });
      } : undefined}
      onPointerMove={active ? (event) => { if (start.current) setDraft(rectFrom(start.current, toNormalized(event))); } : undefined}
      onPointerUp={active ? (event) => {
        const rect = start.current ? rectFrom(start.current, toNormalized(event)) : null;
        start.current = null;
        setDraft(null);
        setPtRegionDrawing(false);
        // A click without a drag clears the region.
        updateCompositionRenderSettings(compositionId, { region: rect && rect.width > 0.01 && rect.height > 0.01 ? rect : undefined });
      } : undefined}
    >
      {shown && (
        <div className="pt-region-rect" style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`,
          width: `${shown.width * 100}%`, height: `${shown.height * 100}%` }} />
      )}
    </div>
  );
}
