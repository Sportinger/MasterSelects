import { useTimelineStore } from '../../../../stores/timeline';
import type { TerrainPlacement } from '../../../../types/terrainTracking';
import { layerBuilder } from '../../../../services/layerBuilder';
import { renderHostPort } from '../../../../services/render/renderHostPort';
import './surfaceTracking.css';

/** Ordinary composition clips keep their terrain placement independently editable. */
export function TerrainAttachmentControls({clipId}:{clipId:string}) {
  const clip=useTimelineStore(state=>state.clips.find(value=>value.id===clipId));
  const attachment=clip?.terrainAttachment??clip?.terrainScreenAnchor?.attachment;
  if(!clip||!attachment)return null;
  const change=(placement:Partial<TerrainPlacement>)=>{
    const current=useTimelineStore.getState().clips.find(value=>value.id===clipId);
    if(!current)return;
    const original=current.terrainAttachment??current.terrainScreenAnchor?.attachment;
    if(!original)return;
    const next={...original,placement:{...original.placement,...placement}};
    useTimelineStore.getState().updateClip(clipId,current.terrainAttachment?{terrainAttachment:next}:{terrainScreenAnchor:{...current.terrainScreenAnchor!,attachment:next}});
    layerBuilder.invalidateCache();renderHostPort.requestRender();
  };
  return <div className="surface-tracking">
    <p className="surface-quality">{clip.terrainAttachment?'Terrain projection':'Tracked screen anchor'}</p>
    <p className="surface-help">The video owns the camera and mesh. This clip owns its placement. Open the composition to edit its shapes, text and masks; trim the parent clip to change its timing.</p>
    {clip.terrainScreenAnchor?.labelLayout&&<button type="button" onPointerDown={event=>event.preventDefault()} onClick={()=>{
      const current=useTimelineStore.getState().clips.find(value=>value.id===clipId);if(!current?.terrainScreenAnchor)return;
      useTimelineStore.getState().updateClip(clipId,{terrainScreenAnchor:{...current.terrainScreenAnchor,labelLayout:undefined}});layerBuilder.invalidateCache();renderHostPort.requestRender();
    }}>Use manual card offsets</button>}
    {(['x','y','width','height','rotation'] as const).map(key=><label key={key}>{({x:'Across terrain',y:'Along terrain',width:'Projection width',height:'Projection height',rotation:'Projection rotation'})[key]}
      <input aria-label={`Terrain attachment ${key}`} type="number" step={key==='rotation'?1:.01} value={Number(attachment.placement[key].toFixed(5))}
        onChange={event=>{const value=event.currentTarget.valueAsNumber;if(Number.isFinite(value)&&(!['width','height'].includes(key)||value>0))change({[key]:value});}} />
    </label>)}
    {clip.terrainScreenAnchor&&(['x','y'] as const).map(axis=><label key={axis}>Card offset {axis.toUpperCase()}
      <input aria-label={`Terrain card offset ${axis}`} type="number" step={.01} value={clip.terrainScreenAnchor!.offset[axis]}
        onChange={event=>{const value=event.currentTarget.valueAsNumber;if(!Number.isFinite(value))return;const current=useTimelineStore.getState().clips.find(item=>item.id===clipId);if(!current?.terrainScreenAnchor)return;
          useTimelineStore.getState().updateClip(clipId,{terrainScreenAnchor:{...current.terrainScreenAnchor,offset:{...current.terrainScreenAnchor.offset,[axis]:value}}});layerBuilder.invalidateCache();renderHostPort.requestRender();}} />
    </label>)}
  </div>;
}
