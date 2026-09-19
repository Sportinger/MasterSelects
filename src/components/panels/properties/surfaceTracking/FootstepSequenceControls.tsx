import { useState } from 'react';
import type { PlanarTrack } from '../../../../types/planarTracking';
import type { TerrainPlacement } from '../../../../types/terrainTracking';
import { createEditableTerrainFootstepPrototype } from '../../../../services/planarTracking/editableFootstepPrototype';
import { createEditableTerrainSequence } from '../../../../services/planarTracking/editableTerrainSequence';

export function FootstepSequenceControls({clipId,track,onChange}:{clipId:string;track:PlanarTrack;onChange:(patch:Partial<PlanarTrack>)=>void}){
  const [selected,setSelected]=useState('');
  const [prototypeMessage,setPrototypeMessage]=useState('');
  const [creatingPrototype,setCreatingPrototype]=useState(false);
  const terrain=track.terrain,steps=terrain?.footsteps;
  if(!terrain||!steps?.length)return null;
  const step=steps.find(value=>value.id===selected)??steps[0],p=step.placement;
  const change=(patch:Partial<TerrainPlacement>)=>onChange({terrain:{...terrain,footsteps:steps.map(value=>value.id===step.id?{...value,placement:{...value.placement,...patch}}:value)}});
  return <>
    <p className="surface-quality">{steps.length} future footprints</p>
    <label><input aria-label="Decision HUD" type="checkbox" checked={track.footstepPresentation==='decision'} onClick={event=>{if(event.detail>0)event.currentTarget.blur();}} onChange={event=>onChange({footstepPresentation:event.target.checked?'decision':undefined})}/>Decision HUD</label>
    {track.footstepPresentation==='decision'?<p className="surface-help">Nearby search for the next two contacts. The following contact can turn green shortly before the preceding landing. Scores and alternatives are fictional visual effects.</p>:<label>Show steps ahead (seconds)<input aria-label="Footstep look ahead" type="number" min={.1} max={10} step={.1} value={track.footstepLookAhead??3} onChange={event=>{const value=event.currentTarget.valueAsNumber;if(Number.isFinite(value)&&value>=.1&&value<=10)onChange({footstepLookAhead:value});}}/></label>}
    {track.footstepPresentation==='decision'&&<>
      <label><input aria-label="Scenic HUD interlude" type="checkbox" checked={!!track.footstepInterlude} onClick={event=>{if(event.detail>0)event.currentTarget.blur();}} onChange={event=>onChange({footstepInterlude:event.target.checked?{start:track.referenceTime,end:track.referenceTime+2.5,dropMeters:300,dropGreaterThan:true}:undefined})}/>Scenic HUD interlude</label>
      {track.footstepInterlude&&<label><input aria-label="Drop lower bound" type="checkbox" checked={!!track.footstepInterlude.dropGreaterThan} onClick={event=>{if(event.detail>0)event.currentTarget.blur();}} onChange={event=>onChange({footstepInterlude:{...track.footstepInterlude!,dropGreaterThan:event.target.checked}})}/>Show drop as greater than</label>}
      {track.footstepInterlude&&(['start','end','dropMeters'] as const).map(key=><label key={key}>{({start:'Interlude start (seconds)',end:'Interlude end (seconds)',dropMeters:'Fictional drop (meters)'})[key]}<input aria-label={`HUD ${key}`} type="number" step={key==='dropMeters'?1:.05} value={track.footstepInterlude![key]} onChange={event=>{const value=event.currentTarget.valueAsNumber;if(Number.isFinite(value)&&value>=0)onChange({footstepInterlude:{...track.footstepInterlude!,[key]:key==='dropMeters'?Math.min(999,value):value}});}}/></label>)}
    </>}
    <label>Footstep<select aria-label="Footstep" value={step.id} onChange={event=>setSelected(event.target.value)}>{steps.map(value=><option key={value.id} value={value.id}>{value.name} · {value.placement.contactTime?.toFixed(2)}s</option>)}</select></label>
    {(['x','y','width','height','rotation','contactTime'] as const).map(key=><label key={key}>{({x:'Across ground',y:'Along ground',width:'Shoe width',height:'Shoe length',rotation:'Shoe rotation',contactTime:'Contact time'})[key]}<input aria-label={`Footstep ${key}`} type="number" step={key==='rotation'?1:.01} value={Number(p[key]!.toFixed(5))} onChange={event=>{const value=event.currentTarget.valueAsNumber;if(Number.isFinite(value)&&(!(key==='width'||key==='height')||value>0)){
      if(key==='contactTime')onChange({terrain:{...terrain,footsteps:steps.map(valueStep=>valueStep.id===step.id?{...valueStep,placement:{...p,contactTime:value}}:valueStep).toSorted((a,b)=>a.placement.contactTime!-b.placement.contactTime!)}});
      else change({[key]:value});
    }}}/></label>)}
    {track.footstepPresentation==='decision'&&<>
      <label>Lock time (seconds; empty = automatic)<input aria-label="Footstep lockTime" type="number" step={.01} value={p.lockTime??''} onChange={event=>{const value=event.currentTarget.valueAsNumber;if(event.currentTarget.value==='')change({lockTime:undefined});else if(Number.isFinite(value))change({lockTime:value});}}/></label>
      {(['labelX','labelY'] as const).map(key=><label key={key}>{key==='labelX'?'Foot label across':'Foot label along'}<input aria-label={`Footstep ${key}`} type="number" min={0} max={1} step={.01} value={p[key]??(key==='labelX'?.5:.415)} onChange={event=>{const value=event.currentTarget.valueAsNumber;if(Number.isFinite(value)&&value>=0&&value<=1)change({[key]:value});}}/></label>)}
    </>}
    <label><input type="checkbox" checked={p.profile==='hiking'} onClick={event=>{if(event.detail>0)event.currentTarget.blur();}} onChange={event=>change({profile:event.target.checked?'hiking':undefined})}/>Hiking sole tread</label>
    <p className="surface-help">The tread is stylized. Contact positions and shoe dimensions are estimated from the video and can be adjusted here.</p>
    <div className="surface-buttons"><button type="button" disabled={creatingPrototype||p.contactTime===undefined} onClick={()=>void (async()=>{setCreatingPrototype(true);try{const result=await createEditableTerrainFootstepPrototype({targetVideoClipId:clipId,track,step});setPrototypeMessage(`Created ${result.composition.name}. Open its editable-footstep child comp to edit the contour, lugs and label.`);}catch(error){setPrototypeMessage(error instanceof Error?error.message:String(error));}finally{setCreatingPrototype(false);}})()}>Create editable terrain prototype</button></div>
    <p role="status" className="surface-help">{prototypeMessage}</p>
    <div className="surface-buttons"><button type="button" disabled={creatingPrototype} onPointerDown={event=>event.preventDefault()} onClick={()=>void (async()=>{setCreatingPrototype(true);try{const result=await createEditableTerrainSequence({targetVideoClipId:clipId,track});setPrototypeMessage(`Created ${result.contacts} contacts and ${result.events} editable inspections. Open the footprint, card or HUD composition clips to edit their native shapes and text.`);}catch(error){setPrototypeMessage(error instanceof Error?error.message:String(error));}finally{setCreatingPrototype(false);}})()}>Create full editable HUD</button></div>
  </>;
}
