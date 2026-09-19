import { useEffect, useRef, useState } from 'react';
import type { PlanarTrack, SurfaceQuad } from '../../../../types/planarTracking';
import { useTimelineStore } from '../../../../stores/timeline';
import { editSurfaceTracks } from '../../../../services/planarTracking/surfaceTrackEditing';
import { solveTerrain } from '../../../../services/planarTracking/solveTerrain';
import { TerrainSceneView } from './TerrainSceneView';
import { DenseTerrainControls } from './DenseTerrainControls';

export function TerrainTrackingControls({clipId,track,url,file,time,quad,from,to,disabled,onBusy,sourceName,onTrace}: {
  clipId:string;track:PlanarTrack;url:string;file?:Blob;time:number;quad:SurfaceQuad;from:number;to:number;disabled:boolean;onBusy:(busy:boolean)=>void;
  sourceName?:string;onTrace:()=>void;
}) {
  const [start,setStart]=useState(Math.max(from,time-2)),[end,setEnd]=useState(Math.min(to,time+2));
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const controller=useRef<AbortController|null>(null);
  useEffect(()=>()=>controller.current?.abort(),[]);
  const update=(patch:Partial<PlanarTrack>)=>editSurfaceTracks(clipId,'Edit 3D surface',list=>list.map(t=>t.id===track.id?{...t,...patch}:t));
  const run=async()=>{
    const abort=new AbortController();controller.current=abort;setBusy(true);onBusy(true);
    try {
      if(![start,end,time].every(Number.isFinite)||start<from||end>to||start>=end||time<start||time>end)throw new Error('Choose a source range that includes the displayed reference frame and stays inside the clip.');
      const terrain=await solveTerrain({url,file,from:start,to:end,referenceTime:time,quad,signal:abort.signal,onProgress:setMessage});
      abort.signal.throwIfAborted();
      const current=useTimelineStore.getState().clips.find(c=>c.id===clipId);
      if((current?.source?.mediaFileId??current?.mediaFileId??clipId)!==track.sourceId)throw new Error('The source changed. Solve the current video again.');
      editSurfaceTracks(clipId,'Solve 3D camera and ground mesh',list=>{
        if(list.find(t=>t.id===track.id)!==track)throw new Error('The surface changed during solving. Run again from the current surface.');
        return list.map(t=>t.id===track.id?{...t,terrain,projection:'mesh',showMesh:true}:t);
      });
      setMessage(`Solved ${terrain.cameras.length}/${terrain.sourceFrameCount} camera frames · ${terrain.triangles.length/3} mesh triangles`);
    }catch(error){setMessage(abort.signal.aborted?'3D solve cancelled; previous surface kept.':error instanceof Error?error.message:String(error));}
    finally{controller.current=null;setBusy(false);onBusy(false);}
  };
  const blocked=disabled||busy;
  const meshes=track.terrain?.footsteps?.map(step=>step.mesh??track.terrain!.denseMesh!)??(track.terrain?.denseMesh?[track.terrain.denseMesh]:[]);
  const denseVertices=meshes.reduce((sum,mesh)=>sum+mesh.positions.length/3,0),denseTriangles=meshes.reduce((sum,mesh)=>sum+mesh.indices.length/3,0);
  return <><DenseTerrainControls clipId={clipId} track={track} sourceName={sourceName} disabled={blocked} onBusy={onBusy} onTrace={onTrace}/><fieldset className="surface-terrain"><legend>3D camera &amp; ground mesh</legend>
    <p className="surface-help">Reconstruct a short section around this frame. The first mesh connects sparse 3D observations; small rocks and unsupported areas may remain unresolved.</p>
    <label>Source start <input aria-label="3D solve source start" type="number" min={from} max={to} step="0.1" value={Number(start.toFixed(3))} disabled={blocked} onChange={e=>setStart(e.currentTarget.valueAsNumber)}/></label>
    <label>Source end <input aria-label="3D solve source end" type="number" min={from} max={to} step="0.1" value={Number(end.toFixed(3))} disabled={blocked} onChange={e=>setEnd(e.currentTarget.valueAsNumber)}/></label>
    <div className="surface-buttons"><button type="button" disabled={blocked} onClick={()=>void run()}>Solve 3D camera + mesh</button>
      {busy&&<button type="button" onClick={()=>controller.current?.abort()}>Cancel 3D solve</button>}</div>
    {track.terrain&&<>
      <label>Projection <select aria-label="Surface projection" value={track.projection??'planar'} disabled={blocked} onChange={e=>update({projection:e.target.value as 'mesh'|'planar'})}><option value="planar">Planar track</option><option value="mesh">3D ground mesh</option></select></label>
      <label><input type="checkbox" checked={track.showMesh??false} disabled={blocked} onClick={event=>{if(event.detail>0)event.currentTarget.blur();}} onChange={e=>update({showMesh:e.target.checked})}/> Show mesh wireframe</label>
      <div className="surface-quality">{track.terrain.cameras.length}/{track.terrain.sourceFrameCount} camera frames · {track.terrain.denseMesh?denseVertices:track.terrain.vertices.length} vertices · {track.terrain.denseMesh?denseTriangles:track.terrain.triangles.length/3} triangles · {track.terrain.medianError.toFixed(2)}px median fit</div>
      <p className="surface-help">Only solved frames are shown. Lens calibration is estimated; the mesh has relative scale. Inspect the wireframe for drift and missing coverage.</p>
      {!track.terrain.denseMesh&&<details><summary>Inspect 3D geometry</summary><TerrainSceneView terrain={track.terrain} time={time}/></details>}
    </>}
    <p role="status">{message}</p>
  </fieldset></>;
}
