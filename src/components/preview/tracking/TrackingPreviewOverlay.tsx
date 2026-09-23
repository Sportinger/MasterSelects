import { trackingLivePreview } from '../../../services/planarTracking/trackingLivePreview';
import { TrackingLivePreview } from './TrackingLivePreview';
import { useRef, useSyncExternalStore } from 'react';
import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTrackingStore } from '../../../stores/trackingStore';
import { useTrackingEditorStore } from '../../../stores/trackingEditorStore';
import { sampleOcclusion, sampleSurface, inverseMatrix, projectPoint, quadMatrix } from '../../../services/planarTracking/surfaceGeometry';
import { surfaceSourceTime } from '../../../services/planarTracking/surfaceEffects';
import { sampleTerrainCamera } from '../../../services/planarTracking/terrainProjection';
import { defaultTerrainPlacement, pickTerrainPoint } from '../../../services/planarTracking/terrainPlacement';
import { trackingPreviewTransform } from '../../../services/planarTracking/trackingPreviewTransform';
import { getTerrainSurfaceReconstruction } from '../../../services/planarTracking/terrainSurfaceMesh';
import { layerBuilder } from '../../../services/layerBuilder';
import { renderHostPort } from '../../../services/render/renderHostPort';
import type { SurfacePoint, SurfaceQuad } from '../../../types/planarTracking';
import { TrackingGeometryPreview } from './TrackingGeometryPreview';
import { ObjectTrackingOverlay } from './ObjectTrackingOverlay';

const defaultQuad:SurfaceQuad=[{x:.3,y:.3},{x:.7,y:.3},{x:.7,y:.7},{x:.3,y:.7}];

export function TrackingPreviewOverlay({displayedCompId,width,height,resolution}: {displayedCompId:string|null;width:number;height:number;resolution:{width:number;height:number}}) {
  const editor=useTrackingEditorStore();
  const live=useSyncExternalStore(trackingLivePreview.subscribe,trackingLivePreview.snapshot);
  const clips=useTimelineStore(s=>s.clips);
  const playhead=useTimelineStore(s=>s.playheadPosition);
  const disabled=useTimelineStore(s=>s.isPlaying||s.isExporting||!!s.tracks.find(t=>t.id===s.clips.find(c=>c.id===editor.clipId)?.trackId)?.locked);
  const compositionId=useMediaStore(s=>s.activeCompositionId);
  const files=useMediaStore(s=>s.files);
  const asset=useTrackingStore(s=>s.assets.find(a=>a.id===editor.assetId));
  const drag=useRef<number|null>(null);
  const selected=clips.find(c=>c.id===editor.clipId);
  const source=selected?.trackingBinding
    ? clips.find(c=>c.id===selected.trackingBinding!.targetVideoClipId)
    : selected?.source?.type==='video'?selected:clips.find(c=>c.id===asset?.sourceVideoClipId);
  const track=selected?.trackingBinding?asset?.track:source?.planarTracks?.find(t=>t.id===editor.trackId)??asset?.track;
  if(!editor.active||displayedCompId!==compositionId||!track||width<=0||height<=0)return null;
  if(live?.clipId===source?.id&&live?.trackId===track.id)return <TrackingLivePreview width={width} height={height}/>;
  if(editor.view==='3d'&&track.terrain)return <div className="tracking-preview-layer" style={{width,height}}><TrackingGeometryPreview terrain={track.terrain} width={width} height={height}/></div>;
  if(!source)return null;
  const timeline=useTimelineStore.getState();
  const time=surfaceSourceTime(source,Math.max(0,playhead-source.startTime),timeline.getClipKeyframes(source.id));
  const frame=sampleSurface(track,time);
  const file=files.find(f=>f.id===(source.source?.mediaFileId??source.mediaFileId));
  const transform=timeline.getInterpolatedTransform(source.id,playhead-source.startTime);
  const mapping=trackingPreviewTransform(transform,{width:file?.width??track.terrain?.intrinsics.width??resolution.width,height:file?.height??track.terrain?.intrinsics.height??resolution.height},resolution);
  if(track.object && editor.tool!=='place' && editor.tool!=='occlusion') {
    return <ObjectTrackingOverlay showOutline={!!frame||!!editor.contourDraft||!!editor.objectPrompts.length} points={editor.contourDraft??frame?.contour??track.object.referenceContour} width={width} height={height}
      disabled={disabled} toSource={mapping.toSource} toComposition={mapping.toComposition}/>;
  }
  const quad=editor.draft??(editor.tool==='occlusion'?sampleOcclusion(track,time):frame?.quad)??track.referenceQuad??defaultQuad;
  const displayQuad=quad.map(mapping.toComposition);
  const editing=!disabled&&!editor.actionBusy&&(editor.tool==='surface'||editor.tool==='occlusion');
  const placing=!disabled&&editor.tool==='place'&&!!selected?.trackingBinding;
  if(!editing&&!placing&&!frame)return null;
  const point=(event:{clientX:number;clientY:number},element:Element):SurfacePoint=>{
    const rect=element.getBoundingClientRect();return mapping.toSource({x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height});
  };
  const move=(index:number,p:SurfacePoint)=>{
    const next=quad.map(v=>({...v})) as SurfaceQuad;next[index]={x:Math.max(0,Math.min(1,p.x)),y:Math.max(0,Math.min(1,p.y))};editor.setEditor({draft:next});
  };
  const place=(pixel:SurfacePoint)=>{
    const binding=selected?.trackingBinding;if(!binding)return;
    try{
      let next={...binding};
      if(track.terrain){
        const terrain=getTerrainSurfaceReconstruction(track.terrain);
        const camera=sampleTerrainCamera(terrain,time),mesh=terrain.denseMesh;
        if(!camera||!mesh)throw new Error('No reconstructed surface on this frame.');
        const hit=pickTerrainPoint(terrain,camera,pixel);
        if(!hit)throw new Error('No mesh at this point. Choose a reconstructed area.');
        const delta=hit.map((v,i)=>v-mesh.origin[i]);
        next={...binding,placement:{...(binding.placement??defaultTerrainPlacement(mesh)),x:delta.reduce((s,v,i)=>s+v*mesh.axisX[i],0),y:delta.reduce((s,v,i)=>s+v*mesh.axisY[i],0)}};
      }else{
        if(!frame)throw new Error('No tracking on this frame.');
        const inverse=inverseMatrix(quadMatrix(frame.quad));if(!inverse)throw new Error('The tracked surface is degenerate.');
        const local=projectPoint(inverse,pixel);
        next={...binding,point:local,...(binding.placement?{placement:{...binding.placement,x:local.x,y:local.y}}:{})};
      }
      timeline.updateClip(selected!.id,{trackingBinding:next});layerBuilder.invalidateCache();renderHostPort.requestRender();editor.setEditor({tool:'inspect',message:''});
    }catch(e){editor.setEditor({message:e instanceof Error?e.message:String(e)});}
  };
  return <svg className="tracking-preview-layer tracking-preview-handles" width={width} height={height} viewBox={`0 0 ${width} ${height}`} style={{pointerEvents:editing||placing?'auto':'none'}}
    onPointerDown={e=>{if(placing){e.preventDefault();e.stopPropagation();place(point(e,e.currentTarget));}}}
    onPointerMove={e=>{if(drag.current!==null&&editing)move(drag.current,point(e,e.currentTarget));}}
    onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
    {!placing&&<polygon points={displayQuad.map(p=>`${p.x*width},${p.y*height}`).join(' ')} fill={editing?'#50c8ff15':'none'} stroke={editor.tool==='occlusion'?'#ffb853':'#50c8ff'} strokeWidth={1.5}/>}
    {editing&&displayQuad.map((p,i)=><circle key={i} cx={p.x*width} cy={p.y*height} r={6} tabIndex={0} role="slider" aria-label={`Tracking corner ${i+1}`} aria-valuetext={`${(quad[i].x*100).toFixed(1)}%, ${(quad[i].y*100).toFixed(1)}%`}
      onPointerDown={e=>{e.preventDefault();e.stopPropagation();drag.current=i;e.currentTarget.setPointerCapture(e.pointerId);}}
      onKeyDown={e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();e.stopPropagation();const step=e.shiftKey?.01:.001;move(i,{x:quad[i].x+(e.key==='ArrowLeft'?-step:e.key==='ArrowRight'?step:0),y:quad[i].y+(e.key==='ArrowUp'?-step:e.key==='ArrowDown'?step:0)});}}/>)}
    {placing&&<text x={12} y={24} fill="#fff" stroke="#000" strokeWidth={3} paintOrder="stroke" fontSize={12}>Click the surface to place the clip</text>}
  </svg>;
}
