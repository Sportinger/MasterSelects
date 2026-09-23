import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { trackingLivePreview } from '../../../services/planarTracking/trackingLivePreview';
import { useTrackingEditorStore } from '../../../stores/trackingEditorStore';

export function TrackingLivePreview({width,height}:{width:number;height:number}) {
  const frame=useSyncExternalStore(trackingLivePreview.subscribe,trackingLivePreview.snapshot);
  const busy=useTrackingEditorStore(s=>s.actionBusy);
  const canvas=useRef<HTMLCanvasElement>(null);
  useLayoutEffect(()=>{
    if(!frame||!canvas.current)return;
    const {pixels,sample}=frame, context=canvas.current.getContext('2d');
    if(!context)return;
    canvas.current.width=pixels.width;canvas.current.height=pixels.height;
    context.putImageData(pixels,0,0);
    const points=sample.contour??sample.quad;
    context.beginPath();points.forEach((p,i)=>i?context.lineTo(p.x*pixels.width,p.y*pixels.height):context.moveTo(p.x*pixels.width,p.y*pixels.height));context.closePath();
    context.strokeStyle='#50c8ff';context.lineWidth=2;context.stroke();
  },[frame]);
  if(!frame)return null;
  return <div className="tracking-preview-layer tracking-live-preview" style={{width,height}}>
    <canvas ref={canvas} aria-label="Live tracking preview"/>
    <div className="tracking-live-caption"><span>{busy?'Tracking':'Last tracked frame'} · {frame.sample.time.toFixed(3)} s</span>
      {!busy&&<button onPointerUp={e=>e.currentTarget.blur()} onClick={()=>trackingLivePreview.clear()}>Back to video</button>}</div>
  </div>;
}
