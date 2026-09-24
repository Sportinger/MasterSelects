import { useEffect, useRef, useState } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import type { RotoSession } from '../../../services/roto/RotoSession';
import { rotoPreview } from '../../../services/roto/rotoPreview';
import { rotoSessions } from '../../../services/roto/rotoSessions';
import { DEFAULT_ROTO_EDGES, type RotoEdges } from '../../../services/roto/rotoEdges';
import { RotoPreview } from './RotoPreview';
import { projectFileService } from '../../../services/projectFileService';
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
  const [zoom, setZoom] = useState(1), [edges, setEdges] = useState<RotoEdges>({ ...DEFAULT_ROTO_EDGES });
  const [points, setPoints] = useState<RotoPoint[]>([]);
  const [mainPreview, setMainPreview] = useState(true);
  const previewOwner = useRef({});
  const session = useRef<RotoSession | undefined>(undefined);
  const operation = useRef<AbortController | undefined>(undefined);
  const [frame, setFrame] = useState<SurfaceDecodedFrame>(), [mask, setMask] = useState<RotoMask>();
  const pointsRef = useRef<RotoPoint[]>([]);
  const supported = clip?.source?.type === 'video' && !clip.source.liveInputId;
  useEffect(() => {
    setHasFrame(false); setCount(0); setBusy(false); setPoints([]); pointsRef.current = []; setMessage(''); setFrame(undefined); setMask(undefined);
    if (!supported || !clip) return;
    let lease: ReturnType<typeof rotoSessions.acquire>;
    try {
      lease = rotoSessions.acquire({ key: `${compositionId}/${clip.id}/${sourceId ?? ''}`,
        scope: projectFileService.getProjectData()?.createdAt ?? 'unsaved',
        url: media?.url ?? clip.source?.videoElement?.currentSrc ?? '', file: clip.file ?? media?.file,
        from: clip.inPoint, to: clip.outPoint });
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); return; }
    const s = lease.session; session.current = s; setEdges({ ...s.edges }); setCount(s.masks.size);
    if (s.lastTime !== undefined) void run(async signal => {
      const decoded = await s.show(s.lastTime!); signal.throwIfAborted();
      display(decoded, s.masks.get(decoded.time)); setMessage('Restored masks and reference points for this clip.');
    });
    return () => {
      const active = operation.current; operation.current = undefined; active?.abort();
      lease.release(); session.current = undefined;
    };
  }, [clip?.id, sourceId, compositionId, media?.file, media?.url, clip?.inPoint, clip?.outPoint]);

  const display = (decoded: SurfaceDecodedFrame, selected?: RotoMask) => {
    setFrame(decoded); setMask(selected); setSourceTime(decoded.time); setHasFrame(true);
    pointsRef.current = session.current?.anchors.get(decoded.time) ?? []; setPoints(pointsRef.current);
    setCount(session.current?.masks.size ?? 0);
  };
  const changeEdges = (next: RotoEdges) => { setEdges(next); if (session.current) session.current.edges = next; };
  const report = (value: number, text: string) => { setProgress(value); setMessage(text); };
  const run = async (action: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current) return;
    const abort = new AbortController(); operation.current = abort; setBusy(true); setProgress(0);
    try { await action(abort.signal); }
    catch (error) { if (operation.current === abort) setMessage(abort.signal.aborted ? 'Stopped. Completed masks are kept.' : error instanceof Error ? error.message : String(error)); }
    finally { if (operation.current === abort) { operation.current = undefined; setBusy(false); setReady(rotoRuntime.ready); } }
  };
  const getSession = async () => {
    if (!clip || !supported) throw new Error('Select a source video clip.');
    if (!session.current) throw new Error('Reopen this clip in Roto to start a session.');
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
    pointsRef.current = next; setPoints(next);
    const result = await s.select(next, signal, report); display(s.current, result);
    setMessage('Reference mask updated. Track forward or backward to update neighboring frames.');
  });
  const selectInPreview = (point: RotoPoint, sourceTime: number) => run(async signal => {
    const s = await getSession(), previousTime = s.current?.time;
    const decoded = await s.show(sourceTime); signal.throwIfAborted();
    const next = [...(previousTime === decoded.time ? pointsRef.current : s.anchors.get(decoded.time) ?? []), point];
    display(decoded, s.masks.get(decoded.time)); pointsRef.current = next; setPoints(next);
    const result = await s.select(next, signal, report); signal.throwIfAborted(); display(decoded, result);
    setMessage('Reference mask updated from Preview. Track forward or backward to update neighboring frames.');
  });
  useEffect(() => {
    const owner = previewOwner.current;
    return () => rotoPreview.clear(owner);
  }, []);
  useEffect(() => {
    const s = session.current;
    if (!mainPreview || !supported || !clip || !s) { rotoPreview.clear(previewOwner.current); return; }
    rotoPreview.show(previewOwner.current, { clipId: clip.id, compositionId, session: s, edges, busy, label,
      points, pointTime: frame?.time, onPoint: (point, time) => void selectInPreview(point, time) });
  }, [mainPreview, supported, clip?.id, sourceId, compositionId, media?.file, media?.url, clip?.inPoint, clip?.outPoint, edges, busy, label, points, frame, count]);
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
    const blob = await encodeRotoMaskVideo(frames, signal, report, cutout ? time => s.read(time) : undefined, s.edges); signal.throwIfAborted();
    const name = `${clip.name.replace(/\.[^.]+$/, '')} - Roto ${cutout ? 'cutout' : 'mask'} from ${start.toFixed(3)}s.${cutout ? 'webm' : 'mp4'}`;
    const imported = await useMediaStore.getState().importFile(new File([blob], name, { type: blob.type }), undefined, { forceCopyToProject: true });
    if (!('type' in imported) || imported.type !== 'video') throw new Error('Mask video import failed.');
    setMessage(`${cutout ? 'Transparent cutout' : 'Mask video'} added to Media. Video time 0 corresponds to source ${start.toFixed(3)} s.`);
  });

  return <div className="browser-roto" onKeyDown={e => e.stopPropagation()} onPointerUp={e => {
    if (e.target instanceof Element) e.target.closest<HTMLElement>('button,input[type="checkbox"]')?.blur();
  }}>
    <ResolveInspectorSection title="Browser Rotoscoping" indicator="none">
      {!supported ? <p>Select a video clip to begin.</p> : <>
        <div className="roto-actions">
          <button disabled={busy || ready} onClick={() => void run(async signal => { await rotoRuntime.prepare(signal, report); setMessage('SAM 2.1 ready. Load the current source frame.'); })}>{ready ? 'SAM 2.1 ready' : 'Load SAM 2.1 · 190 MB'}</button>
          <button disabled={busy || !ready} onClick={() => { rotoRuntime.dispose(); setReady(false); }}>Unload model</button>
          <button disabled={busy} onClick={() => void show()}>Use current frame</button>
        </div>
        <p className="roto-hint">Click the object in the main Preview. Right-click or Ctrl/Command-click excludes. Runs locally with WebGPU.</p>
        <div className="roto-actions">
          <button aria-pressed={mainPreview} onClick={() => setMainPreview(v => !v)}>Edit in Preview</button>
          <button aria-pressed={label === 1} disabled={busy} onClick={() => setLabel(1)}>Include</button>
          <button aria-pressed={label === 0} disabled={busy} onClick={() => setLabel(0)}>Exclude</button>
          <button disabled={busy || points.length === 0} onClick={() => {
            const next = pointsRef.current.slice(0, -1);
            if (next.some(p => p.label === 1)) void select(next);
            else { pointsRef.current = []; setPoints([]); session.current?.clearCurrentPoints(); setCount(session.current?.masks.size ?? 0); setMask(undefined); }
          }}>Undo point</button>
        </div>
        {hasFrame && frame && <ResolveInspectorSection title="Detail preview" defaultOpen={false} indicator="none">
          <ResolveInspectorRow label="Preview"><InspectorSelect ariaLabel="Roto preview" value={view} disabled={busy} onChange={setView}
            options={[{ value: 'overlay', label: 'Selection overlay' }, { value: 'mask', label: 'Mask' }, { value: 'cutout', label: 'Cutout' }, { value: 'source', label: 'Source' }]} /></ResolveInspectorRow>
          <ResolveInspectorRow label="Zoom"><InspectorSelect ariaLabel="Roto preview zoom" value={String(zoom)} onChange={v => setZoom(Number(v))}
            options={[{ value: '1', label: 'Fit' }, { value: '2', label: '200%' }, { value: '4', label: '400%' }]} /></ResolveInspectorRow>
          <RotoPreview frame={frame} mask={mask} points={points} edges={edges} view={view} zoom={zoom}
            label={label} disabled={busy} onPoint={point => void select([...pointsRef.current, point])} />
        </ResolveInspectorSection>}
        {hasFrame && <>
          <ResolveInspectorSection title="Mask edges" indicator="none">
            <ResolveInspectorNumberRow label="Expand / shrink (px)" value={edges.offset} defaultValue={0} min={-8} max={8} hardMin={-8} hardMax={8} step={.1} disabled={busy} onChange={offset => changeEdges({ ...edges, offset })} />
            <ResolveInspectorNumberRow label="Edge softness (px)" value={edges.softness} defaultValue={0} min={0} max={8} hardMin={0} hardMax={8} step={.1} disabled={busy} onChange={softness => changeEdges({ ...edges, softness })} />
          </ResolveInspectorSection>
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
          <div className="roto-actions">
            <button disabled={busy || !count} onClick={() => { session.current?.clearMasks(); setCount(0); pointsRef.current = []; setPoints([]); setMask(undefined); setMessage('Masks and reference points for this clip were cleared.'); }}>Clear clip masks</button>
          </div>
          <p className="roto-hint">{count} masks · Add points on any frame to correct the selection, then track again. Masks stay available across panel and clip switches in this tab. Export before reloading or closing the editor.</p>
        </>}
      </>}
      {busy && <div className="roto-actions"><progress aria-label="Rotoscoping progress" value={progress} max={1} /><button onClick={() => operation.current?.abort()}>Stop rotoscoping</button></div>}
      <output aria-live="polite">{message}</output>
    </ResolveInspectorSection>
  </div>;
}
