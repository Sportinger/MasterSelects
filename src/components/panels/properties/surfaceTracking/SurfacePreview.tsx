import { useEffect, useRef, useState } from 'react';
import type { SurfaceQuad, SurfacePoint } from '../../../../types/planarTracking';
import { openSurfaceFrames, type SurfaceFrameReader, type SurfaceFrameStamp } from '../../../../services/planarTracking/surfaceFrameReader';

interface Props {
  url: string;
  file?: Blob;
  time: number;
  quad: SurfaceQuad;
  occlusion: SurfaceQuad | null;
  mode: 'surface' | 'occlusion' | 'footprint';
  footprint?: SurfacePoint[];
  showSurfaceOutline?: boolean;
  onFootprintPoint?: (point:SurfacePoint)=>void;
  disabled: boolean;
  onChange: (quad: SurfaceQuad) => void;
  onReady: (ready: boolean) => void;
  onFrame: (stamp: SurfaceFrameStamp) => void;
  onIndex: (frames: readonly SurfaceFrameStamp[]) => void;
  onError: (message: string) => void;
}

export function SurfacePreview({ url, file, time, quad, occlusion, mode, footprint, showSurfaceOutline=true, onFootprintPoint, disabled, onChange, onReady, onFrame, onIndex, onError }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null), svg = useRef<SVGSVGElement>(null);
  const [reader, setReader] = useState<SurfaceFrameReader | null>(null);
  const [aspect, setAspect] = useState(16 / 9);
  const drag = useRef<number | null>(null);
  const latestTime = useRef(time); latestTime.current = time;
  const onReadyRef = useRef(onReady); onReadyRef.current = onReady;
  const onErrorRef = useRef(onError); onErrorRef.current = onError;
  const onFrameRef = useRef(onFrame); onFrameRef.current = onFrame;
  const onIndexRef = useRef(onIndex); onIndexRef.current = onIndex;
  const seekQueue = useRef(Promise.resolve());
  useEffect(() => {
    const controller = new AbortController();
    let owned: SurfaceFrameReader | null = null;
    setReader(null); onReadyRef.current(false); onIndexRef.current([]);
    void openSurfaceFrames(url, controller.signal, file).then(value => {
      owned = value;
      if (controller.signal.aborted) { value.close(); return; }
      onIndexRef.current(value.frames); setReader(value);
    }).catch(e => { if (!controller.signal.aborted) onErrorRef.current(String(e.message)); });
    return () => { controller.abort(); owned?.close(); };
  }, [url, file]);
  useEffect(() => {
    onReadyRef.current(false);
    if (!reader) return;
    let disposed = false;
    seekQueue.current = seekQueue.current.catch(() => undefined).then(async () => {
      if (disposed) return;
      const frame = await reader.read(time);
      if (disposed || latestTime.current !== time || !canvas.current) return;
      canvas.current.width = frame.pixels.width; canvas.current.height = frame.pixels.height;
      canvas.current.getContext('2d')?.putImageData(frame.pixels, 0, 0);
      setAspect(frame.pixels.width / frame.pixels.height);
      onFrameRef.current({ time: frame.time, duration: frame.duration });
      onReadyRef.current(true);
    }).catch(e => { if (!disposed) onErrorRef.current(String(e.message)); });
    return () => { disposed = true; };
  }, [reader, time]);
  const editable = mode === 'footprint' ? null : mode === 'surface' ? quad : occlusion;
  return <div className="surface-preview" style={{ aspectRatio: aspect, width: `min(100%, ${46 * aspect}vh)` }}>
    <canvas ref={canvas} />
    <svg ref={svg} viewBox="0 0 1000 1000" preserveAspectRatio="none"
      onClick={event=>{if(mode!=='footprint'||disabled)return;const bounds=event.currentTarget.getBoundingClientRect();onFootprintPoint?.({x:(event.clientX-bounds.left)/bounds.width,y:(event.clientY-bounds.top)/bounds.height});}}
      onPointerMove={event => {
        if (drag.current === null || disabled || !editable || !svg.current) return;
        const bounds = svg.current.getBoundingClientRect();
        const next = editable.map(p => ({ ...p })) as SurfaceQuad;
        next[drag.current] = { x: Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width)), y: Math.max(0,Math.min(1,(event.clientY-bounds.top)/bounds.height)) };
        onChange(next);
      }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {showSurfaceOutline&&mode!=='footprint'&&<polygon points={quad.map(p=>`${p.x*1000},${p.y*1000}`).join(' ')} className="surface-outline" />}
      {mode==='footprint'&&<><polygon points={(footprint??[]).map(p=>`${p.x*1000},${p.y*1000}`).join(' ')} className="surface-outline"/>{footprint?.map((p,i)=><circle key={i} cx={p.x*1000} cy={p.y*1000} r="8" fill="#ff3535"/>)}</>}
      {occlusion && <polygon points={occlusion.map(p=>`${p.x*1000},${p.y*1000}`).join(' ')} className="surface-occlusion" />}
      {!disabled && editable?.map((p,i)=><circle key={`${mode}-${i}`} cx={p.x*1000} cy={p.y*1000} r="13" tabIndex={0} role="slider"
        aria-label={`${mode === 'surface' ? 'Surface' : 'Occlusion'} corner ${i+1}`} aria-valuetext={`${Math.round(p.x*100)}%, ${Math.round(p.y*100)}%`}
        onPointerDown={event=>{event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);drag.current=i;}}
        onKeyDown={event=>{
          if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
          event.preventDefault(); event.stopPropagation();
          const amount=event.shiftKey?0.01:0.001;
          const next=editable.map(point=>({...point})) as SurfaceQuad;
          next[i]={x:Math.max(0,Math.min(1,p.x+(event.key==='ArrowLeft'?-amount:event.key==='ArrowRight'?amount:0))),y:Math.max(0,Math.min(1,p.y+(event.key==='ArrowUp'?-amount:event.key==='ArrowDown'?amount:0)))};
          onChange(next);
        }} />)}
    </svg>
  </div>;
}
