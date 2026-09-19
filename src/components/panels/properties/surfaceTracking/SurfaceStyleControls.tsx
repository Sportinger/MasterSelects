import type { PlanarTrack } from '../../../../types/planarTracking';

export function SurfaceStyleControls({track,time,disabled,onChange}:{track:PlanarTrack;time:number;disabled:boolean;onChange:(patch:Partial<PlanarTrack>)=>void}) {
  const footsteps=!!track.terrain?.footsteps?.length;
  return <fieldset disabled={disabled} className="surface-style"><legend>Attached marker</legend>
    <label><input type="checkbox" checked={track.enabled} onClick={event=>{if(event.detail>0)event.currentTarget.blur();}} onChange={e=>onChange({enabled:e.target.checked})}/> Show overlay</label>
    <label>Name <input aria-label="Surface name" value={track.name} maxLength={80} onChange={e=>onChange({name:e.target.value})}/></label>
    <label>Color <input type="color" value={track.color} onChange={e=>onChange({color:e.target.value})}/></label>
    <label>Shape <select disabled={footsteps} value={footsteps||track.placement?.contour?'footprint':track.shape} onChange={e=>{if(e.target.value==='footprint')return;onChange({shape:e.target.value as PlanarTrack['shape'],...(track.placement?{placement:{...track.placement,contour:undefined,contactTime:undefined}}:{})});}}>{(footsteps||track.placement?.contour)&&<option value="footprint">{footsteps?'Footprint sequence':'Traced footprint'}</option>}<option value="outline">Outline</option><option value="ellipse">Ellipse</option><option value="cross">Rejected / cross</option></select></label>
    {([['opacity','Opacity',0,1,.05],['fill','Fill',0,1,.05],['lineWidth','Line width',1,8,.5],['inset','Inset',0,.45,.01],['fade','Fade (seconds)',0,2,.05]] as const).map(([key,label,min,max,step])=><label key={key}>{label}<input type="number" min={min} max={max} step={step} value={track[key]} disabled={key==='inset'&&(footsteps||!!track.placement?.contour)} onChange={e=>{const value=e.currentTarget.valueAsNumber;if(Number.isFinite(value))onChange({[key]:Math.max(min,Math.min(max,value))});}}/></label>)}
    <div className="surface-buttons"><button type="button" onClick={()=>onChange({visibleFrom:Math.min(time,track.visibleTo)})}>Start here</button><button type="button" onClick={()=>onChange({visibleTo:Math.max(time,track.visibleFrom)})}>End here</button></div>
    <small>Visible {track.visibleFrom.toFixed(3)}–{track.visibleTo.toFixed(3)}s in source</small>
  </fieldset>;
}
