import { useMemo, useState } from 'react';
import { useTimelineStore } from '../../../../stores/timeline';
import { useTrackingEditorStore } from '../../../../stores/trackingEditorStore';
import { bindClipToTrackingAsset, isTrackingBindingEligibleClip } from '../../../../services/planarTracking/trackingBinding';
import { layerBuilder } from '../../../../services/layerBuilder';
import { renderHostPort } from '../../../../services/render/renderHostPort';

export function TrackingAttachPicker({assetId,sourceClipId,mode}:{assetId:string;sourceClipId?:string;mode:'follow'|'surface'}) {
  const clips=useTimelineStore(s=>s.clips);
  const playhead=useTimelineStore(s=>s.playheadPosition);
  const [query,setQuery]=useState(''),[targetId,setTargetId]=useState(''),[error,setError]=useState('');
  const candidates=useMemo(()=>clips.filter(c=>c.id!==sourceClipId&&isTrackingBindingEligibleClip(c)&&c.name.toLowerCase().includes(query.toLowerCase()))
    .toSorted((a,b)=>Number(b.startTime<=playhead&&b.startTime+b.duration>playhead)-Number(a.startTime<=playhead&&a.startTime+a.duration>playhead)).slice(0,40),[clips,query,sourceClipId,playhead]);
  return <fieldset className="surface-terrain"><legend>{mode==='surface'?'Project a clip':'Attach a clip'}</legend>
    <input aria-label="Find clip to attach" placeholder="Find a clip…" value={query} onChange={e=>{setQuery(e.target.value);setTargetId('');}}/>
    <select aria-label="Clip to attach" value={targetId} onChange={e=>setTargetId(e.target.value)}><option value="">Choose clip…</option>{candidates.map(c=><option key={c.id} value={c.id}>{c.name} · {c.startTime.toFixed(2)}s</option>)}</select>
    {!candidates.length&&<span className="surface-quality">Add a text, shape or media clip to this timeline first.</span>}
    <div className="surface-buttons"><button disabled={!targetId} onClick={()=>{
      try{bindClipToTrackingAsset(targetId,assetId,mode);useTimelineStore.getState().selectClip(targetId);layerBuilder.invalidateCache();renderHostPort.requestRender();
        useTrackingEditorStore.getState().setEditor({clipId:targetId,assetId,openedAssetId:null,attachMode:null,tool:'inspect',view:'video',message:'Connected. Use Place in Preview to position the clip.'});
        window.dispatchEvent(new CustomEvent('openPropertiesTab',{detail:{tab:'tracking'}}));
      }catch(e){setError(e instanceof Error?e.message:String(e));}
    }}>Connect</button><button onClick={()=>useTrackingEditorStore.getState().setEditor({attachMode:null})}>Cancel</button></div>
    <p role="status" className="surface-status">{error}</p>
  </fieldset>;
}
