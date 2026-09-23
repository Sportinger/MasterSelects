import { useTimelineStore } from '../../stores/timeline';
import { useHistoryStore } from '../../stores/historyStore';
import { useMediaStore } from '../../stores/mediaStore';
import type { PlanarTrack } from '../../types/planarTracking';
import type { TimelineClip } from '../../types/timeline';
import type { Keyframe } from '../../types/keyframes';
import { sampleSurface } from '../planarTracking/surfaceGeometry';
import { surfaceSourceTime } from '../planarTracking/surfaceEffects';
import { createMaskPathProperty } from '../../types/animationProperties';

/** Bake at composition frames, preserving retiming, backwards playback and coverage gaps. */
export function objectMaskKeys(clip:TimelineClip,track:PlanarTrack,maskId:string,fps:number,sourceKeys:Keyframe[]):Keyframe[] {
  if(!track.object||!Number.isFinite(fps)||fps<=0)throw new Error('Select an object track first.');
  const count=Math.ceil(clip.duration*fps);
  if(count>18000)throw new Error('Trim the clip to 18,000 output frames or fewer before creating its mask.');
  const keys:Keyframe[]=[];let previousTime:number|undefined,previousVisible:boolean|undefined;
  for(let i=0;i<count;i++) {
    const time=i/fps,sourceTime=surfaceSourceTime(clip,time,sourceKeys),sample=sampleSurface(track,sourceTime);
    const visible=!!sample?.contour&&sample.time>=track.visibleFrom&&sample.time<=track.visibleTo;
    if(visible===previousVisible&&(!visible||sample!.time===previousTime))continue;
    previousVisible=visible;previousTime=sample?.time;
    // A closed zero-area path rasterizes to an empty mask; disabled/absent masks
    // would instead fall back to full effect coverage in the mask consumer.
    const points=visible?sample!.contour!:track.object.referenceContour.map(()=>({x:-1,y:-1}));
    keys.push({id:crypto.randomUUID(),clipId:clip.id,time,property:createMaskPathProperty(maskId),value:0,easing:'linear',hold:true,
      pathValue:{closed:true,vertices:points.map((p,index)=>({...p,id:`${maskId}:point:${index}`,handleIn:{x:0,y:0},handleOut:{x:0,y:0},handleMode:'none'}))}});
  }
  return keys;
}

export function createObjectMask(clipId:string,track:PlanarTrack):string {
  const timeline=useTimelineStore.getState(),clip=timeline.clips.find(c=>c.id===clipId);
  if(!clip||timeline.isExporting||timeline.tracks.find(t=>t.id===clip.trackId)?.locked)throw new Error('The clip is locked or unavailable.');
  if(!track.object||!track.samples.some(s=>s.contour))throw new Error('Select or track an object first.');
  const media=useMediaStore.getState(),fps=media.compositions.find(c=>c.id===media.activeCompositionId)?.frameRate??30;
  const maskId=crypto.randomUUID(),keys=objectMaskKeys(clip,track,maskId,fps,timeline.getClipKeyframes(clipId));
  const first=keys.find(k=>k.pathValue?.vertices.some(v=>v.x>=0));
  if(!first)throw new Error('There is no tracked object inside this clip.');
  const history=useHistoryStore.getState(),batch=history.startBatch('Create tracked object mask');
  try {
    const mask={id:maskId,name:track.name,vertices:first.pathValue!.vertices,closed:true,opacity:1,feather:0,featherQuality:50,inverted:false,
      mode:'add' as const,expanded:true,position:{x:0,y:0},enabled:true,visible:true,compositeEnabled:false};
    timeline.updateClip(clipId,{masks:[...(clip.masks??[]),mask]});
    useTimelineStore.setState(state=>{
      const clipKeyframes=new Map(state.clipKeyframes);
      clipKeyframes.set(clipId,[...(clipKeyframes.get(clipId)??[]),...keys].toSorted((a,b)=>a.time-b.time));
      return {clipKeyframes};
    });
    useTimelineStore.getState().invalidateCache();return maskId;
  }finally{if(batch.opened)history.endBatch();}
}
