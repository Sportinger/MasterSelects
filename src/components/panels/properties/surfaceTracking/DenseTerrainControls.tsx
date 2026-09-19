import { useRef, useState } from 'react';
import type { PlanarTrack } from '../../../../types/planarTracking';
import { parseDenseTerrain, MAX_TERRAIN_IMPORT_BYTES } from '../../../../services/planarTracking/denseTerrainImport';
import { defaultTerrainPlacement } from '../../../../services/planarTracking/terrainPlacement';
import { editSurfaceTracks } from '../../../../services/planarTracking/surfaceTrackEditing';
import { useTimelineStore } from '../../../../stores/timeline';
import { FootstepSequenceControls } from './FootstepSequenceControls';

export function DenseTerrainControls({clipId,track,sourceName,disabled,onBusy,onTrace}:{clipId:string;track:PlanarTrack;sourceName?:string;disabled:boolean;onBusy:(value:boolean)=>void;onTrace:()=>void}){
  const input=useRef<HTMLInputElement>(null);
  const [message,setMessage]=useState(''),[busy,setBusy]=useState(false),[address,setAddress]=useState('');
  const update=(patch:Partial<PlanarTrack>)=>{try{editSurfaceTracks(clipId,'Edit mesh marker',list=>list.map(t=>t.id===track.id?{...t,...patch}:t));}catch(e){setMessage(String(e));}};
  const load=async(file?:File)=>{
    setBusy(true);onBusy(true);setMessage('Reading camera and mesh…');
    try{
      let text:string;
      if(file){if(file.size>MAX_TERRAIN_IMPORT_BYTES)throw new Error('Reconstruction exceeds 100 MB.');text=await file.text();}
      else{
        const url=new URL(address);if(!['https:','http:'].includes(url.protocol))throw new Error('Enter an HTTP or HTTPS reconstruction URL.');
        const response=await fetch(url,{credentials:'omit',signal:AbortSignal.timeout(60000)});
        if(!response.ok)throw new Error(`Download failed (${response.status}).`);
        const reader=response.body?.getReader();if(!reader)throw new Error('Empty reconstruction response.');
        const parts:Uint8Array<ArrayBuffer>[]=[];let size=0;
        try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_TERRAIN_IMPORT_BYTES)throw new Error('Reconstruction exceeds 100 MB.');parts.push(value as Uint8Array<ArrayBuffer>);}}
        finally{await reader.cancel();reader.releaseLock();}
        text=await new Blob(parts).text();
      }
      const terrain=parseDenseTerrain(text,sourceName);
      const current=useTimelineStore.getState().clips.find(c=>c.id===clipId);
      if(!current||(current.source?.mediaFileId??current.mediaFileId??clipId)!==track.sourceId)throw new Error('The video source changed during import.');
      editSurfaceTracks(clipId,'Import dense camera and ground mesh',list=>{
        if(list.find(t=>t.id===track.id)!==track)throw new Error('The surface changed during import. Import again.');
        return list.map(t=>t.id===track.id?{...t,terrain,projection:'mesh',placement:defaultTerrainPlacement(terrain.denseMesh!),showMesh:false,...(terrain.footsteps?.length?{visibleFrom:terrain.cameras[0].time,visibleTo:terrain.cameras.at(-1)!.time+terrain.cameras.at(-1)!.duration,footstepLookAhead:3,fade:.1}:{} )}:t);
      });
      setMessage(`Imported ${terrain.cameras.length} camera frames and ${(terrain.denseMesh!.indices.length/3).toLocaleString()} triangles.`);
    }catch(e){setMessage(e instanceof Error?e.message:String(e));}
    finally{setBusy(false);onBusy(false);if(input.current)input.current.value='';}
  };
  const mesh=track.terrain?.denseMesh,placement=mesh?(track.placement??defaultTerrainPlacement(mesh)):null;
  return <fieldset className="surface-terrain" disabled={disabled||busy}><legend>Dense reconstruction</legend>
    <input ref={input} hidden type="file" accept=".json,.msterrain.json" onChange={e=>{const file=e.target.files?.[0];if(file)void load(file);}}/>
    <button type="button" onClick={()=>input.current?.click()}>Import camera + mesh…</button>
    <details><summary>Import from URL</summary><label>Reconstruction URL <input type="url" aria-label="Reconstruction URL" value={address} onChange={e=>setAddress(e.target.value)}/></label><button type="button" disabled={!address} onClick={()=>void load()}>Load reconstruction</button></details>
    {mesh&&placement&&<>
      <FootstepSequenceControls clipId={clipId} track={track} onChange={update}/>
      <p className="surface-quality">{track.terrain?.footsteps?.length?`${track.terrain.footsteps.length} local ground patches`:`${(mesh.indices.length/3).toLocaleString()} triangles`} · reusable ground reconstruction</p>
      <p className="surface-help">Position and dimensions use the reconstruction’s relative units. A traced contact area takes its size from the video.</p>
      {!track.terrain?.footsteps?.length&&<>
      {(['x','y','width','height','rotation'] as const).map(key=><label key={key}>{({x:'Across ground',y:'Along ground',width:'Marker width',height:'Marker length',rotation:'Marker rotation'})[key]}<input aria-label={`Mesh marker ${key}`} type="number" step={key==='rotation'?1:Math.min(...mesh.size)/100} value={Number(placement[key].toFixed(5))} min={key==='width'||key==='height'?0.00001:undefined} onChange={e=>{const value=e.currentTarget.valueAsNumber;if(Number.isFinite(value)&&(!(key==='width'||key==='height')||value>0))update({placement:{...placement,[key]:value}});}}/></label>)}
      {placement.contour&&<label><input type="checkbox" checked={placement.profile==='hiking'} onClick={event=>{if(event.detail>0)event.currentTarget.blur();}} onChange={event=>update({placement:{...placement,profile:event.target.checked?'hiking':undefined}})}/>Hiking sole tread</label>}
      <button type="button" onClick={onTrace}>Trace footprint on this frame</button>
      {placement.contour&&<><p className="surface-help">Contact captured at {placement.contactTime?.toFixed(3)}s. Use “Start here” on an earlier frame to reveal this footprint before landing.</p><button type="button" onClick={()=>update({placement:{...placement,contour:undefined,contactTime:undefined}})}>Use standard marker shape</button></>}
      <button type="button" onClick={()=>{try{editSurfaceTracks(clipId,'Duplicate mesh marker',list=>[...list,{...track,id:crypto.randomUUID(),name:`${track.name} copy`,placement:{...placement}}]);setMessage('Marker duplicated. Select its copy in the Surface list.');}catch(e){setMessage(String(e));}}}>Duplicate marker on this mesh</button>
      </>}
    </>}
    <p role="status">{message}</p>
  </fieldset>;
}
