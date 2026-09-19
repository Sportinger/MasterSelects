import { useEffect, useMemo, useRef, useState } from 'react';
import { useTimelineStore } from '../../../../stores/timeline';
import { useMediaStore } from '../../../../stores/mediaStore';
import type { PlanarTrack, SurfaceQuad, SurfacePoint } from '../../../../types/planarTracking';
import { footprintPlacement } from '../../../../services/planarTracking/terrainPlacement';
import { replaceSamples, sampleOcclusion, sampleSurface, validQuad } from '../../../../services/planarTracking/surfaceGeometry';
import { surfaceSourceTime } from '../../../../services/planarTracking/surfaceEffects';
import { editSurfaceTracks } from '../../../../services/planarTracking/surfaceTrackEditing';
import { trackSurface } from '../../../../services/planarTracking/trackSurface';
import { surfaceFrameIndex, type SurfaceFrameStamp } from '../../../../services/planarTracking/surfaceFrameReader';
import { SurfacePreview } from './SurfacePreview';
import { SurfaceStyleControls } from './SurfaceStyleControls';
import { TerrainTrackingControls } from './TerrainTrackingControls';
import { sampleTerrainCamera } from '../../../../services/planarTracking/terrainProjection';
import './surfaceTracking.css';

const DEFAULT_QUAD: SurfaceQuad = [{x:.3,y:.3},{x:.7,y:.3},{x:.7,y:.7},{x:.3,y:.7}];

export function LegacySurfaceTrackingTab({ clipId }: { clipId: string }) {
  const clip = useTimelineStore(s=>s.clips.find(c=>c.id===clipId));
  const playhead = useTimelineStore(s=>s.playheadPosition);
  const playing = useTimelineStore(s=>s.isPlaying);
  const locked = useTimelineStore(s=>s.isExporting||s.tracks.find(t=>t.id===s.clips.find(c=>c.id===clipId)?.trackId)?.locked);
  const file = useMediaStore(s=>s.files.find(f=>f.id===(clip?.source?.mediaFileId??clip?.mediaFileId)));
  const [url,setUrl]=useState('');
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [time,setTime]=useState(()=>clip?surfaceSourceTime(clip,Math.max(0,useTimelineStore.getState().playheadPosition-clip.startTime),useTimelineStore.getState().getClipKeyframes(clip.id)):0);
  const [draft,setDraft]=useState<SurfaceQuad|null>(null),[draftOcclusion,setDraftOcclusion]=useState<SurfaceQuad|null|undefined>();
  const [mode,setMode]=useState<'surface'|'occlusion'|'footprint'>('surface');
  const [footprint,setFootprint]=useState<SurfacePoint[]>([]);
  const [frames,setFrames]=useState<readonly SurfaceFrameStamp[]>([]);
  const [frame,setFrame]=useState<SurfaceFrameStamp|null>(null);
  const [ready,setReady]=useState(false),[busy,setBusy]=useState(false),[progress,setProgress]=useState(0),[message,setMessage]=useState('');
  const [terrainBusy,setTerrainBusy]=useState(false);
  const abortRef=useRef<AbortController|null>(null);
  const sourceId=clip?.source?.mediaFileId??clip?.mediaFileId??clipId;
  const tracks=clip?.planarTracks??[];
  const track=tracks.find(t=>t.id===selectedId)??tracks[0];
  const sourceFps=track?.fps??file?.fps??30;
  const fps=Number.isFinite(sourceFps)&&sourceFps>0?sourceFps:30;
  const frameTime=frame?.time??time;
  const sample=track?sampleSurface(track,frameTime):null;
  const meshActive=track?.projection==='mesh';
  const terrainCamera=meshActive&&track.terrain?sampleTerrainCamera(track.terrain,frameTime):null;
  const coveredFrames=meshActive?track?.terrain?.cameras??[]:track?.samples??[];
  const quad=draft??sample?.quad??track?.referenceQuad??DEFAULT_QUAD;
  const occlusion=draftOcclusion!==undefined?draftOcclusion:track?sampleOcclusion(track,frameTime):null;
  const disabled=busy||terrainBusy||!!locked;
  useEffect(()=>{
    if (!clip || clip.source?.type!=='video' || clip.source.liveInputId) return;
    const sourceFile=clip.file;
    if(sourceFile?.size) {const owned=URL.createObjectURL(sourceFile);setUrl(owned);return()=>URL.revokeObjectURL(owned);}
    setUrl(clip.source.videoElement?.currentSrc??'');
  },[clip?.file,clip?.source?.videoElement,clip?.source?.type,clip?.source?.liveInputId]);
  useEffect(()=>()=>{abortRef.current?.abort();},[clipId]);
  useEffect(()=>{setDraft(null);setDraftOcclusion(undefined);},[time,track?.id]);
  useEffect(()=>{setFootprint([]);},[time,track?.id]);
  const bounds=useMemo(()=>{
    const from=clip?.inPoint??0, out=clip?.outPoint??0;
    const last=surfaceFrameIndex(frames,out-1e-6);
    return {from,to:last>=0?Math.max(from,frames[last].time):Math.max(from,out-1/fps)};
  },[clip?.inPoint,clip?.outPoint,frames,fps]);
  useEffect(()=>{
    if (!clip || busy || playing || locked) return;
    const source=surfaceSourceTime(clip,Math.max(0,playhead-clip.startTime),useTimelineStore.getState().getClipKeyframes(clipId));
    const next=Math.max(clip.inPoint,Math.min(clip.outPoint,source));
    if (Math.abs(next-time)>1e-7) { setReady(false); setTime(next); }
  },[clip,clipId,playhead,playing,busy,locked,bounds,fps,time]);
  if (!clip || clip.source?.type!=='video'||clip.source.liveInputId) return <p className="surface-help">Select a video clip to track a surface.</p>;

  const report=(fn:()=>void)=>{try{fn();setMessage('');}catch(e){setMessage(e instanceof Error?e.message:String(e));}};
  const update=(patch:Partial<PlanarTrack>)=>{
    if (!track) return;
    editSurfaceTracks(clipId,'Edit surface track',list=>list.map(t=>t.id===track.id?{...t,...patch}:t));
  };
  const moveTime=(next:number)=>{
    const value=Math.max(clip.inPoint,Math.min(clip.outPoint,next));
    if (Math.abs(value-time)>1e-7) { setReady(false); setTime(value); }
    const timeline=useTimelineStore.getState();
    const current=timeline.clips.find(c=>c.id===clipId);
    if(!current) return;
    // Invert the existing speed mapping, so source-frame navigation follows a retimed clip.
    const keys=timeline.getClipKeyframes(clipId);let a=0,b=current.duration;
    const forward=surfaceSourceTime(current,b,keys)>=surfaceSourceTime(current,a,keys);
    for(let i=0;i<30;i++){const m=(a+b)/2;const source=surfaceSourceTime(current,m,keys);if(forward?source<value:source>value)a=m;else b=m;}
    timeline.setPlayheadPosition(current.startTime+(a+b)/2);
  };
  const add=()=>report(()=>{
    const t:PlanarTrack={id:crypto.randomUUID(),name:`Surface ${tracks.length+1}`,sourceId,fps,referenceTime:frameTime,referenceQuad:structuredClone(DEFAULT_QUAD),
      samples:[],occlusions:[],enabled:true,color:'#ff3535',opacity:.9,fill:.12,lineWidth:2,inset:0,shape:'outline',visibleFrom:bounds.from,visibleTo:bounds.to,fade:0};
    editSurfaceTracks(clipId,'Add surface track',list=>[...list,t]);setSelectedId(t.id);setDraft(structuredClone(DEFAULT_QUAD));
  });
  const save=()=>report(()=>{
    if(!track) return;
    if(mode==='occlusion') {
      if(occlusion&&!validQuad(occlusion)) throw new Error('Occlusion corners must form a non-crossing area.');
      update({occlusions:[...track.occlusions.filter(k=>Math.abs(k.time-frameTime)>1e-7),{time:frameTime,quad:occlusion}].toSorted((a,b)=>a.time-b.time)});setDraftOcclusion(undefined);
    } else {
      if(!validQuad(quad)) throw new Error('Surface corners must form a non-crossing area.');
      const changed=replaceSamples(track,[{time:frameTime,duration:frame?.duration,quad:structuredClone(quad),confidence:1,manual:true}],frameTime,frameTime);
      update({...changed,referenceTime:frameTime,referenceQuad:structuredClone(quad)});setDraft(null);
    }
  });
  const run=async(direction:-1|1)=>{
    if(!track||!ready||!validQuad(quad)) return;
    const controller=new AbortController();abortRef.current=controller;setBusy(true);setProgress(0);setMessage('Tracking surface…');
    const original=track;
    try {
      const to=direction===1?bounds.to:bounds.from;
      const result=await trackSurface({url,file:clip.file,track,from:frameTime,to,quad,signal:controller.signal,onProgress:(p)=>setProgress(p)});
      controller.signal.throwIfAborted();
      const currentClip=useTimelineStore.getState().clips.find(c=>c.id===clipId);
      if((currentClip?.source?.mediaFileId??currentClip?.mediaFileId??clipId)!==sourceId) throw new Error('The video source changed during tracking. Run again on the current source.');
      editSurfaceTracks(clipId,'Track surface',list=>{
        if(list.find(t=>t.id===original.id)!==original) throw new Error('The surface changed during tracking. Run again from the current version.');
        return list.map(t=>t.id===original.id?{...replaceSamples(t,result.samples,Math.min(frameTime,to),Math.max(frameTime,to)),referenceTime:frameTime,referenceQuad:structuredClone(quad)}:t);
      });
      setDraft(null);setMessage(result.stopped?`Stopped — ${result.stopped}`:`Tracked ${result.samples.length} frames. Scrub to check the surface.`);
    } catch(e) {setMessage(controller.signal.aborted?'Tracking cancelled; previous track kept.':e instanceof Error?e.message:String(e));}
    finally {setBusy(false);abortRef.current=null;}
  };
  return <div className="surface-tracking" onPointerUp={event=>{if(event.target instanceof HTMLElement&&event.target.closest('button'))event.target.closest('button')?.blur();}}>
    <div className="surface-heading"><strong>Surface Tracking</strong><button type="button" disabled={disabled||!url} onClick={add}>+ Surface</button></div>
    <p className="surface-help">Place four corners around one textured, roughly flat area. Track from a clear frame in either direction.</p>
    {!!tracks.length&&<label>Surface <select aria-label="Surface" value={track?.id} disabled={disabled} onChange={e=>setSelectedId(e.target.value)}>{tracks.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
    {!url?<p>Relink the original video to enable tracking.</p>:<SurfacePreview url={url} file={clip.file} time={time} quad={quad} occlusion={occlusion} mode={mode} disabled={disabled||!track||!ready||(meshActive&&mode==='surface')}
      showSurfaceOutline={!meshActive} footprint={footprint} onFootprintPoint={point=>setFootprint(points=>points.length<32?[...points,point]:points)}
      onChange={q=>mode==='surface'?setDraft(q):setDraftOcclusion(q)} onReady={setReady} onFrame={setFrame} onIndex={setFrames} onError={setMessage}/>}
    {mode==='footprint'&&track?.terrain?.denseMesh&&<fieldset className="surface-terrain"><legend>Future footprint</legend>
      <p className="surface-help">Choose the moment the sole rests on the ground, then click around its contact outline in order (3–32 points). Outline the sole, not the upper shoe. The mesh determines position and relative size.</p>
      <div className="surface-buttons"><button type="button" disabled={disabled||!footprint.length} onClick={()=>setFootprint(points=>points.slice(0,-1))}>Undo last point</button>
        <button type="button" disabled={disabled||footprint.length<3||!terrainCamera} onClick={()=>report(()=>{if(!terrainCamera)return;const placement=footprintPlacement(track.terrain!,terrainCamera,footprint);update({placement,inset:0,visibleTo:frameTime,visibleFrom:Math.max(bounds.from,frameTime-1),fade:.1});setMode('surface');setMessage('Footprint captured. Scrub backward to see the future contact area.');})}>Capture contact footprint</button>
        <button type="button" onClick={()=>setMode('surface')}>Cancel outline</button></div>
      <details><summary>Add outline point with keyboard</summary><label>X <input id="footprint-x" type="number" min="0" max="1" step=".01" defaultValue=".5"/></label><label>Y <input id="footprint-y" type="number" min="0" max="1" step=".01" defaultValue=".5"/></label><button type="button" onClick={e=>{const group=e.currentTarget.closest('details');const inputs=group?.querySelectorAll('input');if(!inputs)return;const [x,y]=Array.from(inputs).map(input=>input.valueAsNumber);if([x,y].every(v=>Number.isFinite(v)&&v>=0&&v<=1))setFootprint(points=>points.length<32?[...points,{x,y}]:points);}}>Add outline point</button></details>
    </fieldset>}
    <div className="surface-transport"><button type="button" aria-label="Previous source frame" disabled={disabled||!ready||frameTime<=bounds.from} onClick={()=>moveTime(frames[Math.max(0,surfaceFrameIndex(frames,frameTime)-1)]?.time??time-1/fps)}>◀</button>
      <input aria-label="Tracking source time" type="range" min={bounds.from} max={bounds.to} step={1/fps} value={time} disabled={disabled} onChange={e=>moveTime(Number(e.target.value))}/>
      <button type="button" aria-label="Next source frame" disabled={disabled||!ready||frameTime>=bounds.to} onClick={()=>moveTime(frames[Math.min(frames.length-1,surfaceFrameIndex(frames,frameTime)+1)]?.time??time+1/fps)}>▶</button>
      <input aria-label="Source time in seconds" type="number" min={bounds.from} max={bounds.to} step={1/fps} value={Number(time.toFixed(3))} disabled={disabled}
        onChange={event=>{if(Number.isFinite(event.currentTarget.valueAsNumber))moveTime(event.currentTarget.valueAsNumber);}}/></div>
    {frame&&<div className="surface-quality">Decoded frame {frame.time.toFixed(6)}s · {(frame.duration*1000).toFixed(2)}ms · Frame-locked overlay</div>}
    {track&&<>
      <div className="surface-buttons"><button type="button" aria-pressed={mode==='surface'} disabled={disabled} onClick={()=>setMode('surface')}>Surface corners</button>
        <button type="button" aria-pressed={mode==='occlusion'} disabled={disabled} onClick={()=>{setMode('occlusion');if(!occlusion)setDraftOcclusion(structuredClone(DEFAULT_QUAD));}}>Occlusion corners</button></div>
      <p className="surface-help">{mode==='surface'?'Drag corners, or use Tab and arrow keys. Save a correction before continuing a lost track.':'Outline a shoe or other obstruction. Saved occlusion keys interpolate and exclude this area from both tracking and the overlay.'}</p>
      {meshActive&&<p className="surface-help">3D projection is active. Switch to Planar track below to choose a new surface area.</p>}
      <div className="surface-buttons"><button type="button" disabled={disabled||!ready||mode==='footprint'||(meshActive&&mode==='surface')} onClick={save}>Save {mode==='surface'?'surface':'occlusion'} key</button>
        {mode==='occlusion'&&<button type="button" disabled={disabled} onClick={()=>report(()=>{update({occlusions:[...track.occlusions.filter(k=>Math.abs(k.time-frameTime)>1e-7),{time:frameTime,quad:null}].toSorted((a,b)=>a.time-b.time)});setDraftOcclusion(undefined);})}>End occlusion here</button>}
      </div>
      <div className="surface-buttons"><button type="button" disabled={disabled||meshActive||!ready||mode!=='surface'||time<=bounds.from} onClick={()=>void run(-1)}>Track backward</button>
        <button type="button" disabled={disabled||meshActive||!ready||mode!=='surface'||time>=bounds.to} onClick={()=>void run(1)}>Track forward</button>
        {busy&&<button type="button" onClick={()=>abortRef.current?.abort()}>Cancel</button>}</div>
      {busy&&<><progress aria-label="Surface tracking progress" max={1} value={progress}/><span>{Math.round(progress*100)}% of this pass</span></>}
      <div className="surface-quality">{meshActive?(terrainCamera?`Solved 3D camera · ${terrainCamera.error.toFixed(2)}px fit`:'No solved camera on this frame — 3D overlay hidden.'):sample?`${sample.manual?'Manual key':`${Math.round(sample.confidence*100)}% confidence`} · ${track.samples.length} tracked frames`:'No track on this frame — overlay hidden until tracked or keyed.'}</div>
      {track.samples.some(s=>s.duration===undefined)&&<p className="surface-help">This track contains legacy frame estimates. Retrack from a clear frame to store decoded timestamps.</p>}
      {!!coveredFrames.length&&<div className="surface-buttons">
        <span>Tracked {coveredFrames[0].time.toFixed(3)}–{coveredFrames.at(-1)!.time.toFixed(3)}s</span>
        <button type="button" disabled={disabled} onClick={()=>moveTime(coveredFrames[0].time)}>First tracked frame</button>
        <button type="button" disabled={disabled} onClick={()=>moveTime(coveredFrames.at(-1)!.time)}>Last tracked frame</button>
      </div>}
      <SurfaceStyleControls track={track} time={frameTime} disabled={disabled} onChange={patch=>report(()=>update(patch))}/>
      <TerrainTrackingControls key={`${clipId}:${track.id}`} clipId={clipId} track={track} url={url} file={clip.file} sourceName={file?.name??clip.file?.name} time={frameTime} quad={quad} from={bounds.from} to={bounds.to} disabled={disabled||!ready} onBusy={setTerrainBusy} onTrace={()=>{setMode('footprint');setFootprint([]);}}/>
      <button type="button" disabled={disabled} onClick={()=>report(()=>{editSurfaceTracks(clipId,'Remove surface track',list=>list.filter(t=>t.id!==track.id));setSelectedId(null);})}>Remove surface</button>
    </>}
    <p role="status" className="surface-status">{message}</p>
  </div>;
}
