import { useEffect, useRef, useState } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { RotoSession } from '../../../services/roto/RotoSession';
import { rotoRuntime } from '../../../services/roto/rotoRuntime';
import { encodeRotoMaskVideo } from '../../../services/roto/rotoMaskVideo';
import { surfaceSourceTime } from '../../../services/planarTracking/surfaceEffects';
import type { SurfaceDecodedFrame } from '../../../services/planarTracking/surfaceFrameReader';
import type { RotoMask, RotoPoint } from '../../../services/roto/rotoTypes';
import { ResolveInspectorRow, ResolveInspectorSection } from '../properties/resolveInspector/ResolveInspectorPrimitives';
import { ResolveInspectorNumberRow } from '../properties/resolveInspector/ResolveInspectorNumberRow';
import { InspectorSelect } from '../../inspector/InspectorSelect';
import './BrowserRotoPanel.css';

export function BrowserRotoPanel() {
  const clip = useTimelineStore(s => s.clips.find(c => s.selectedClipIds.has(c.id)));
  const sourceId = clip?.source?.mediaFileId ?? clip?.mediaFileId;
  const media = useMediaStore(s => s.files.find(f => f.id === sourceId));
  const compositionId = useMediaStore(s => s.activeCompositionId);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(rotoRuntime.ready), [hasFrame, setHasFrame] = useState(false);
  const [seconds, setSeconds] = useState(2), [sourceTime, setSourceTime] = useState(0), [count, setCount] = useState(0);
  const [view, setView] = useState('overlay'), [label, setLabel] = useState<0 | 1>(1);
  const [points, setPoints] = useState<RotoPoint[]>([]);
  const canvas = useRef<HTMLCanvasElement>(null), session = useRef<RotoSession | undefined>(undefined);
  const operation = useRef<AbortController | undefined>(undefined), frame = useRef<SurfaceDecodedFrame | undefined>(undefined);
  const mask = useRef<RotoMask | undefined>(undefined), pointsRef = useRef<RotoPoint[]>([]);
  const supported = clip?.source?.type === 'video' && !clip.source.liveInputId;
  useEffect(() => {
    setHasFrame(false); setCount(0); setPoints([]); pointsRef.current = []; setMessage(''); frame.current = undefined; mask.current = undefined;
    return () => { operation.current?.abort(); session.current?.dispose(); session.current = undefined; };
  }, [clip?.id, sourceId, compositionId, media?.file, media?.url, clip?.inPoint, clip?.outPoint]);

  const draw = () => {
    if (!canvas.current || !frame.current) return;
    const target = canvas.current, pixels = frame.current.pixels;
    target.width = pixels.width; target.height = pixels.height;
    const ctx = target.getContext('2d')!;
    const rendered = new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
    const selected = mask.current?.time === frame.current.time ? mask.current.data : undefined;
    for (let i = 0; i < pixels.width * pixels.height; i++) {
      const value = selected?.[i] ?? 0;
      if (view === 'mask') rendered.data[4 * i] = rendered.data[4 * i + 1] = rendered.data[4 * i + 2] = value;
      else if (view === 'cutout' && !value) {
        const shade = ((Math.floor((i % pixels.width) / 16) + Math.floor(i / pixels.width / 16)) % 2) ? 45 : 65;
        rendered.data[4 * i] = rendered.data[4 * i + 1] = rendered.data[4 * i + 2] = shade;
      } else if (view === 'overlay' && value) {
        rendered.data[4 * i] *= .55; rendered.data[4 * i + 1] = rendered.data[4 * i + 1] * .55 + 60;
        rendered.data[4 * i + 2] = rendered.data[4 * i + 2] * .55 + 110;
      }
    }
    ctx.putImageData(rendered, 0, 0);
    if (view === 'overlay') for (const point of pointsRef.current) {
      ctx.beginPath(); ctx.arc(point.x * pixels.width, point.y * pixels.height, 6, 0, 2 * Math.PI);
      ctx.fillStyle = point.label ? '#27ae60' : '#e74c3c'; ctx.fill(); ctx.strokeStyle = 'white'; ctx.lineWidth = 2; ctx.stroke();
    }
  };
  useEffect(draw, [view]);
  const display = (decoded: SurfaceDecodedFrame, selected?: RotoMask) => {
    frame.current = decoded; mask.current = selected; setSourceTime(decoded.time); setHasFrame(true);
    pointsRef.current = session.current?.anchors.get(decoded.time) ?? []; setPoints(pointsRef.current);
    setCount(session.current?.masks.size ?? 0); draw();
  };
  const report = (value: number, text: string) => { setProgress(value); setMessage(text); };
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current) return;
    const abort = new AbortController(); operation.current = abort; setBusy(true); setProgress(0);
    try { await action(abort.signal); }
    catch (error) { setMessage(abort.signal.aborted ? 'Stopped. Completed masks are kept.' : error instanceof Error ? error.message : String(error)); }
    finally { if (operation.current === abort) { operation.current = undefined; setBusy(false); setReady(rotoRuntime.ready); } }
  };
  const getSession = async () => {
    if (!clip || !supported) throw new Error('Select a source video clip.');
    session.current ??= new RotoSession(media?.url ?? clip.source?.videoElement?.currentSrc ?? '', clip.file ?? media?.file, clip.inPoint, clip.outPoint);
    await session.current.open(); return session.current;
  };
  const show = (time?: number) => run(async signal => {
    const s = await getSession(), state = useTimelineStore.getState();
    const localTime = state.playheadPosition - clip!.startTime;
    if (time === undefined && (localTime < 0 || localTime >= clip!.duration)) throw new Error('Move the timeline playhead inside the selected clip.');
    const decoded = await s.show(time ?? surfaceSourceTime(clip!, localTime, state.getClipKeyframes(clip!.id).filter(k => k.property === 'speed')));
    signal.throwIfAborted(); display(decoded, s.masks.get(decoded.time)); setMessage(`Source ${decoded.time.toFixed(3)} s. Click the object here to select it.`);
  });
  const select = (next: RotoPoint[]) => run(async signal => {
    const s = session.current; if (!s?.current) return;
    pointsRef.current = next; setPoints(next); draw();
    const result = await s.select(next, signal, report); display(s.current, result);
    setMessage('Reference mask updated. Track forward or backward to update neighboring frames.');
  });
  const track = (direction: 1 | -1) => run(async signal => {
    const s = session.current; if (!s) return;
    await s.track(direction, seconds, signal, (decoded, selected, fraction) => {
      display(decoded, selected); report(fraction, `Tracking source ${decoded.time.toFixed(3)} s · ${s.masks.size} masks`);
    }, report);
    setMessage(`Tracking complete. ${s.masks.size} source frames. Scrub below to inspect or correct.`);
  });
  const exportMask = (cutout = false) => run(async signal => {
    const s = session.current; if (!s || !clip) return;
    const frames = [...s.masks.values()], start = Math.min(...frames.map(f => f.time));
    const blob = await encodeRotoMaskVideo(frames, signal, report, cutout ? time => s.read(time) : undefined); signal.throwIfAborted();
    const name = `${clip.name.replace(/\.[^.]+$/, '')} - Roto ${cutout ? 'cutout' : 'mask'} from ${start.toFixed(3)}s.${cutout ? 'webm' : 'mp4'}`;
    const imported = await useMediaStore.getState().importFile(new File([blob], name, { type: blob.type }), undefined, { forceCopyToProject: true });
    if (!('type' in imported) || imported.type !== 'video') throw new Error('Mask video import failed.');
    setMessage(`${cutout ? 'Transparent cutout' : 'Mask video'} added to Media. Video time 0 corresponds to source ${start.toFixed(3)} s.`);
  });

  return <div className="browser-roto" onPointerUp={e => {
    if (e.target instanceof Element) e.target.closest<HTMLElement>('button,input[type="checkbox"]')?.blur();
  }}>
    <ResolveInspectorSection title="Browser Rotoscoping" indicator="none">
      {!supported ? <p>Select a video clip to begin.</p> : <>
        <div className="roto-actions">
          <button disabled={busy || ready} onClick={() => void run(async signal => { await rotoRuntime.prepare(signal, report); setMessage('SAM 2.1 ready. Load the current source frame.'); })}>{ready ? 'SAM 2.1 ready' : 'Load SAM 2.1 · 190 MB'}</button>
          <button disabled={busy || !ready} onClick={() => { rotoRuntime.dispose(); setReady(false); }}>Unload model</button>
          <button disabled={busy} onClick={() => void show()}>Use current frame</button>
        </div>
        <p className="roto-hint">Runs locally with WebGPU. Select in the source preview below; clip effects are excluded.</p>
        {hasFrame && <>
          <ResolveInspectorRow label="Preview"><InspectorSelect ariaLabel="Roto preview" value={view} disabled={busy} onChange={setView}
            options={[{ value: 'overlay', label: 'Selection overlay' }, { value: 'mask', label: 'Mask' }, { value: 'cutout', label: 'Cutout' }, { value: 'source', label: 'Source' }]} /></ResolveInspectorRow>
          <div className="roto-actions">
            <button aria-pressed={label === 1} disabled={busy} onClick={() => setLabel(1)}>Include</button>
            <button aria-pressed={label === 0} disabled={busy} onClick={() => setLabel(0)}>Exclude</button>
            <button disabled={busy || points.length === 0} onClick={() => {
              const next = pointsRef.current.slice(0, -1);
              if (next.some(p => p.label === 1)) void select(next);
              else { pointsRef.current = []; setPoints([]); session.current?.clearCurrentPoints(); setCount(session.current?.masks.size ?? 0); mask.current = undefined; draw(); }
            }}>Undo point</button>
          </div>
        </>}
        <canvas ref={canvas} aria-label="Roto source selection" className={hasFrame ? 'roto-source-visible' : ''}
          onContextMenu={e => e.preventDefault()} onPointerDown={e => {
            if (busy || !hasFrame || !canvas.current) return;
            e.preventDefault();
            const rect = canvas.current.getBoundingClientRect();
            const point: RotoPoint = { x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)), label: e.button === 2 || e.ctrlKey || e.metaKey ? 0 : label };
            void select([...pointsRef.current, point]);
          }} />
        {hasFrame && <>
          <ResolveInspectorNumberRow label="Source time (s)" value={sourceTime} defaultValue={clip!.inPoint} min={clip!.inPoint} max={clip!.outPoint} hardMin={clip!.inPoint} hardMax={clip!.outPoint} step={.001} disabled={busy} onChange={setSourceTime} />
          <div className="roto-actions">
            <button disabled={busy} onClick={() => void show(session.current?.stepTime(-1))}>Previous source frame</button>
            <button disabled={busy} onClick={() => void show(sourceTime)}>Go to source time</button>
            <button disabled={busy} onClick={() => void show(session.current?.stepTime(1))}>Next source frame</button>
          </div>
          <ResolveInspectorNumberRow label="Track range (s)" value={seconds} defaultValue={2} min={.1} max={30} hardMin={.1} hardMax={30} step={.1} disabled={busy} onChange={setSeconds} />
          <div className="roto-actions">
            <button disabled={busy || !points.some(p => p.label === 1)} onClick={() => void track(-1)}>Track backward</button>
            <button disabled={busy || !points.some(p => p.label === 1)} onClick={() => void track(1)}>Track forward</button>
            <button disabled={busy || count < 2} onClick={() => void exportMask()}>Mask video to Media</button>
            <button disabled={busy || count < 2} onClick={() => void exportMask(true)}>Cutout to Media</button>
          </div>
          <p className="roto-hint">{count} masks · Add points on any frame to correct the selection, then track again. Export before closing this panel.</p>
        </>}
      </>}
      {busy && <div className="roto-actions"><progress aria-label="Rotoscoping progress" value={progress} max={1} /><button onClick={() => operation.current?.abort()}>Stop rotoscoping</button></div>}
      <output aria-live="polite">{message}</output>
    </ResolveInspectorSection>
  </div>;
}
