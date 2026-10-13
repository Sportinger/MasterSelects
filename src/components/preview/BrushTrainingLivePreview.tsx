import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { engine } from '../../engine/WebGPUEngine';
import { brushPreviewRuntime } from '../../services/photogrammetry/brushPreviewRuntime';
import { BrushPreviewRenderer } from '../../services/photogrammetry/BrushPreviewRenderer';
import './BrushTrainingLivePreview.css';

/** Live training is a Preview mode; the timeline and its camera stay untouched. */
export function BrushTrainingLivePreview() {
  const state = useSyncExternalStore(brushPreviewRuntime.subscribe, brushPreviewRuntime.getSnapshot);
  const canvas = useRef<HTMLCanvasElement>(null);
  const renderer = useRef<BrushPreviewRenderer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState(0);
  const [autoUpdate, setAutoUpdate] = useState(true);
  const visible = state.connected && state.visible;
  const latest = useRef({ path: state.cameraPath, view });
  latest.current = { path: state.cameraPath, view };

  useEffect(() => {
    if (!visible || !autoUpdate || !state.updating) return;
    const request = () => { if (!document.hidden) brushPreviewRuntime.request(); };
    request();
    const timer = setInterval(request, 5000);
    return () => clearInterval(timer);
  }, [visible, autoUpdate, state.updating]);

  useEffect(() => {
    if (!visible || !canvas.current) return;
    const device = engine.getDevice();
    if (!device) { setError('Waiting for the editor GPU. Reopen Live in Preview when it is ready.'); return; }
    let instance: BrushPreviewRenderer;
    try { instance = new BrushPreviewRenderer(canvas.current, device); renderer.current = instance; }
    catch (cause) { setError(String(cause)); return; }
    let disposed = false;
    let loading = false;
    let consumed: Uint8Array | null = null;
    const refresh = async () => {
      if (loading || disposed) return;
      const next = brushPreviewRuntime.getSnapshot();
      if (!next.bytes || next.bytes === consumed) return;
      loading = true; consumed = next.bytes;
      try {
        await instance.update(next.bytes);
        if (!disposed) { instance.render(latest.current.path, latest.current.view); setError(null); }
      } catch (cause) { if (!disposed) setError(String(cause)); }
      finally { loading = false; if (!disposed && brushPreviewRuntime.getSnapshot().bytes !== consumed) void refresh(); }
    };
    const unsubscribe = brushPreviewRuntime.subscribe(() => { void refresh(); });
    const resize = new ResizeObserver(() => {
      try { instance.render(latest.current.path, latest.current.view); } catch (cause) { setError(String(cause)); }
    });
    resize.observe(canvas.current);
    void refresh();
    return () => { disposed = true; unsubscribe(); resize.disconnect(); instance.dispose(); renderer.current = null; };
  }, [visible]);

  useEffect(() => {
    try { renderer.current?.render(state.cameraPath, view); } catch (cause) { setError(String(cause)); }
  }, [view, state.cameraPath]);

  if (!visible) return null;
  const views = state.cameraPath?.poses.length ?? 0;
  return <div className="brush-live-preview" data-testid="brush-live-preview"
    onPointerDown={event => event.stopPropagation()} onMouseDown={event => event.stopPropagation()}
    onWheel={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
    onPointerUp={event => { if (event.target instanceof HTMLElement) event.target.closest('button')?.blur(); }}>
    <div className="brush-live-preview-toolbar">
      <strong>Live training · Step {state.iteration.toLocaleString()}</strong>
      <button className="btn btn-sm" onClick={() => setAutoUpdate(value => !value)} aria-pressed={autoUpdate} disabled={!state.updating}>
        {autoUpdate ? 'Auto update: on' : 'Auto update: off'}
      </button>
      <button className="btn btn-sm" onClick={() => brushPreviewRuntime.setVisible(false)}>Back to timeline</button>
    </div>
    <div className="brush-live-preview-image">
      <canvas ref={canvas} aria-label="Live Gaussian splat training preview"
        style={{ aspectRatio: state.cameraPath ? `${state.cameraPath.width}/${state.cameraPath.height}` : '16/9' }} />
      {!state.bytes && <span className="brush-live-preview-wait">Waiting for the next training snapshot…</span>}
    </div>
    <div className="brush-live-preview-toolbar">
      {views > 0 && <><button className="btn btn-sm" aria-label="Previous training view" onClick={() => setView(value => (value + views - 1) % views)}>‹</button>
        <span>Training view {view % views + 1} / {views}</span>
        <button className="btn btn-sm" aria-label="Next training view" onClick={() => setView(value => (value + 1) % views)}>›</button></>}
      <span>{error ?? state.error ?? state.warning ?? (!state.updating ? 'Saved training snapshot' : views ? 'Updates about every 5 seconds' : 'Scene overview · camera poses unavailable')}</span>
    </div>
  </div>;
}
