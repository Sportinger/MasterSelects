import { useEffect, useRef, useState } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { openSurfaceFrames, type SurfaceFrameReader } from '../../../services/planarTracking/surfaceFrameReader';
import { surfaceSourceTime } from '../../../services/planarTracking/surfaceEffects';
import { depthRuntime } from '../../../services/depthEstimation/depthRuntime';
import { clearDepthModelCache, depthModelCached } from '../../../services/depthEstimation/depthModel';
import { depthImage, normalizeDepth, type DepthRange } from '../../../services/depthEstimation/depthMath';
import { bakeDepthVideo } from '../../../services/depthEstimation/bakeDepthVideo';
import { ResolveInspectorSection, ResolveInspectorRow } from './resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from './resolveInspector/ResolveInspectorNumberRow';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import './depthEstimation.css';

export function DepthEstimationControls({ clipId }: { clipId: string }) {
  const clip = useTimelineStore(s => s.clips.find(c => c.id === clipId));
  const [edge, setEdge] = useState(280), [fps, setFps] = useState(30);
  const [from, setFrom] = useState(clip?.inPoint ?? 0), [to, setTo] = useState(clip?.outPoint ?? 1);
  const [smoothing, setSmoothing] = useState(0.75), [invert, setInvert] = useState(false);
  const [busy, setBusy] = useState(''), [message, setMessage] = useState(''), [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(depthRuntime.ready), [cached, setCached] = useState(false);
  const [hasFrame, setHasFrame] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null), controller = useRef<AbortController | null>(null);
  const sourceId = clip?.source?.mediaFileId ?? clip?.mediaFileId ?? clipId;
  useEffect(() => { void depthModelCached().then(setCached); }, []);
  useEffect(() => {
    setFrom(clip?.inPoint ?? 0); setTo(clip?.outPoint ?? 1); setHasFrame(false);
    return () => { controller.current?.abort(); };
  }, [clipId, sourceId, clip?.inPoint, clip?.outPoint]);
  if (!clip || clip.source?.type !== 'video' || clip.source.liveInputId) return null;
  const report = (value: number, text: string) => { setProgress(value); setMessage(text); };
  const run = async (mode: 'load' | 'frame' | 'live' | 'bake') => {
    if (controller.current) return;
    const abort = new AbortController(); controller.current = abort; setBusy(mode); setProgress(0);
    let reader: SurfaceFrameReader | undefined;
    const ownedUrl = clip.file?.size ? URL.createObjectURL(clip.file) : undefined;
    const url = ownedUrl ?? clip.source?.videoElement?.currentSrc ?? '';
    const original = clip, originalProject = useMediaStore.getState().activeCompositionId;
    const isCurrent = () => {
      const current = useTimelineStore.getState().clips.find(c => c.id === clipId);
      return current && (current.source?.mediaFileId ?? current.mediaFileId ?? current.id) === sourceId
        && current.inPoint === original.inPoint && current.outPoint === original.outPoint
        && useMediaStore.getState().activeCompositionId === originalProject;
    };
    try {
      await depthRuntime.prepare(abort.signal, report); setReady(true); setCached(await depthModelCached());
      if (mode === 'load') { setMessage(`Depth model ready: ${depthRuntime.backend}`); return; }
      if (mode === 'bake') {
        if (from < clip.inPoint || to > clip.outPoint + 1e-6) throw new Error('Choose a source range inside this clip.');
        const blob = await bakeDepthVideo({ url, file: clip.file, from, to, fps, edge, smoothing, invert, signal: abort.signal, progress: report });
        abort.signal.throwIfAborted();
        if (!isCurrent()) throw new Error('The source or composition changed. Bake again.');
        const name = `${clip.name.replace(/\.[^.]+$/, '')} - Depth ${from.toFixed(2)}-${to.toFixed(2)}s ${Date.now()}.mp4`;
        setMessage('Adding depth video to Media');
        await useMediaStore.getState().importFile(new File([blob], name, { type: 'video/mp4' }));
        setMessage(`Depth video added to Media (${(blob.size / 1e6).toFixed(1)} MB). Source range ${from.toFixed(2)}-${to.toFixed(2)} s; no source effects or audio.`);
        return;
      }
      reader = await openSurfaceFrames(url, abort.signal, clip.file);
      let lastTime = -Infinity, range: DepthRange | undefined;
      do {
        abort.signal.throwIfAborted();
        if (!isCurrent()) throw new Error('The source changed. Start depth preview again.');
        const state = useTimelineStore.getState(), current = state.clips.find(c => c.id === clipId)!;
        const local = state.playheadPosition - current.startTime;
        if (local < 0 || local >= current.duration) { setMessage('Move the playhead inside this clip.'); break; }
        const time = surfaceSourceTime(current, local, state.getClipKeyframes(clipId).filter(k => k.property === 'speed'));
        if (Math.abs(time - lastTime) > 1e-5) {
          if (time < lastTime || Math.abs(time - lastTime) > 0.5) range = undefined;
          const decoded = await reader.read(time);
          const depth = await depthRuntime.infer(decoded.pixels, edge, abort.signal);
          abort.signal.throwIfAborted();
          if (!isCurrent()) break;
          const now = useTimelineStore.getState();
          const currentTime = surfaceSourceTime(current, now.playheadPosition - current.startTime, now.getClipKeyframes(clipId).filter(k => k.property === 'speed'));
          const stale = !now.isPlaying && Math.abs(currentTime - time) > 1 / 30;
          if (!stale && canvas.current) {
            const normalized = normalizeDepth(depth.values, range, smoothing); range = normalized.range;
            canvas.current.width = depth.width; canvas.current.height = depth.height;
            canvas.current.style.aspectRatio = `${decoded.pixels.width} / ${decoded.pixels.height}`;
            canvas.current.getContext('2d')!.putImageData(depthImage(normalized.pixels, depth.width, depth.height, invert), 0, 0);
            setHasFrame(true);
            setMessage(`${depthRuntime.backend} | ${Math.round(depth.milliseconds)} ms inference | source ${decoded.time.toFixed(3)} s`);
          }
          if (stale) { setHasFrame(false); setMessage(mode === 'live' ? 'Updating depth after seek...' : 'Playhead moved; estimate the current frame again.'); }
          lastTime = time;
        }
        if (mode === 'live') await new Promise<void>(resolve => setTimeout(resolve, 16));
      } while (mode === 'live');
    } catch (error) { setMessage(abort.signal.aborted ? 'Stopped. Previous depth video kept.' : error instanceof Error ? error.message : String(error)); }
    finally { reader?.close(); if (ownedUrl) URL.revokeObjectURL(ownedUrl); controller.current = null; setBusy(''); setReady(depthRuntime.ready); }
  };
  const number = (label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void, defaultValue: number) =>
    <ResolveInspectorNumberRow label={label} value={value} defaultValue={defaultValue} min={min} max={max} hardMin={min} hardMax={max} step={step} disabled={!!busy} onChange={onChange} />;
  return <div className="depth-estimation" onPointerUp={e => {
    if (e.target instanceof Element) e.target.closest<HTMLElement>('button,select,input[type="checkbox"]')?.blur();
  }}><ResolveInspectorSection title="Depth map">
    <p className="tracking-panel-hint">Local analysis · 99 MB first download</p>
    <div className="tracking-panel-actions">
      <button disabled={!!busy || ready} onClick={() => void run('load')}>{ready ? 'Model ready' : cached ? 'Load cached depth model' : 'Download depth model'}</button>
      <button disabled={!!busy || !ready} onClick={() => { depthRuntime.dispose(); setReady(false); setMessage('Depth model unloaded; download cache kept.'); }}>Unload model</button>
      <button disabled={!!busy} onClick={() => void (async () => { try { depthRuntime.dispose(); await clearDepthModelCache(); setReady(false); setCached(false); setMessage('Depth model cache cleared.'); } catch (error) { setMessage(String(error)); } })()}>Clear model cache</button>
    </div>
    <ResolveInspectorRow label="Quality"><InspectorSelect ariaLabel="Depth quality" value={String(edge)} disabled={!!busy} onChange={v => setEdge(Number(v))}
      options={[{ value: '280', label: 'Fast - 280 px' }, { value: '518', label: 'Detailed - 518 px' }]} /></ResolveInspectorRow>
    {number('Range smoothing', smoothing, 0, 0.95, 0.05, setSmoothing, 0.75)}
    <ResolveInspectorRow label="Polarity"><label><input type="checkbox" checked={invert} disabled={!!busy} onChange={e => setInvert(e.target.checked)} />Invert near / far</label></ResolveInspectorRow>
    <div className="tracking-panel-actions">
      <button disabled={!!busy} onClick={() => void run('frame')}>Estimate frame</button>
      <button disabled={!!busy} onClick={() => void run('live')}>Live preview</button>
      {busy && <button onClick={() => controller.current?.abort()}>Stop</button>}
    </div>
    <canvas ref={canvas} className={hasFrame ? 'depth-map-visible' : ''} aria-label="Estimated depth map" />
    <p className="tracking-panel-hint">White near · black far · source view</p>
  </ResolveInspectorSection>
  <ResolveInspectorSection title="Bake depth video" defaultOpen={false}>
    {number('Source start', from, clip.inPoint, clip.outPoint, 0.01, setFrom, clip.inPoint)}
    {number('Source end', to, clip.inPoint, clip.outPoint, 0.01, setTo, clip.outPoint)}
    <ResolveInspectorRow label="Bake FPS"><InspectorSelect ariaLabel="Depth bake frame rate" value={String(fps)} disabled={!!busy} onChange={v => setFps(Number(v))}
      options={[10, 15, 30].map(v => ({ value: String(v), label: `${v} fps` }))} /></ResolveInspectorRow>
    <div className="tracking-panel-actions"><button disabled={!!busy} onClick={() => void run('bake')}>Bake to Media</button></div>
    <p className="tracking-panel-hint">Reusable grayscale MP4 · up to 120 seconds</p>
  </ResolveInspectorSection>
  {(busy || message) && <div className="tracking-panel-feedback">
    {busy && busy !== 'live' && <progress aria-label="Depth progress" value={progress} max={1} />}
    <output className="tracking-panel-status" aria-live="polite">{message}</output>
  </div>}</div>;
}
