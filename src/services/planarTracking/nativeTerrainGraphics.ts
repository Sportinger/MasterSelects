import { DEFAULT_TEXT_PROPERTIES, DEFAULT_TRANSFORM } from '../../stores/timeline/constants';
import { createDefaultMotionLayerDefinition } from '../../types/motionDesign';
import type { CompositionTimelineData, SerializableClip, TimelineTrack } from '../../types/timeline';
import type { Keyframe } from '../../types/keyframes';
import { FOOTPRINT_COLORS } from './nativeFootprintDesign';

export const CARD_SIZE = { width: 512, height: 184 };
export const nativeId = () => crypto.randomUUID();
export function nativeTrack(name: string): TimelineTrack {
  return { id: nativeId(), name, type: 'video', height: 60, visible: true, muted: false, solo: false };
}
export function nativeTimeline(tracks: TimelineTrack[], clips: SerializableClip[], duration: number): CompositionTimelineData {
  return { tracks, clips, duration, durationLocked: true, playheadPosition: 0, inPoint: null, outPoint: null, zoom: 45, scrollX: 0, loopPlayback: false };
}
export function nativeClip(name: string, trackId: string, start: number, duration: number): SerializableClip {
  return { id: nativeId(), name, trackId, mediaFileId: '', sourceType: 'motion-shape', startTime: start, duration,
    inPoint: 0, outPoint: duration, naturalDuration: duration, transform: structuredClone(DEFAULT_TRANSFORM), effects: [] };
}
export function nativeKey(clip: SerializableClip, property: Keyframe['property'], time: number, value: number): Keyframe {
  return { id: nativeId(), clipId: clip.id, property, time, value, easing: 'linear' };
}
export function nativeFade(clip: SerializableClip, fadeIn = .06, fadeOut = .10): void {
  const end = clip.duration;
  clip.keyframes = [...clip.keyframes ?? [], nativeKey(clip,'opacity',0,fadeIn ? 0 : 1),
    nativeKey(clip,'opacity',Math.min(fadeIn,end*.3),1),
    nativeKey(clip,'opacity',Math.max(fadeIn,end-fadeOut),1), nativeKey(clip,'opacity',end,0)];
}
function rgb(hex: string) {
  return { r: parseInt(hex.slice(1,3),16)/255, g: parseInt(hex.slice(3,5),16)/255, b: parseInt(hex.slice(5,7),16)/255, a: 1 };
}

/** A video track selects one clip at a time; simultaneous artwork needs separate tracks. */
function layeredGraphicsTimeline(clips: SerializableClip[], duration: number): CompositionTimelineData {
  const ordered = [
    ...clips.filter(clip => clip.sourceType === 'text'),
    ...clips.filter(clip => clip.sourceType !== 'text').toReversed(),
  ];
  const tracks = ordered.map(clip => {
    const track = nativeTrack(clip.name);
    clip.trackId = track.id;
    return track;
  });
  return nativeTimeline(tracks, clips, duration);
}
export function nativeRectangle(name: string, trackId: string, start: number, duration: number, width: number, height: number, color: string, stroke = 3): SerializableClip {
  const clip = nativeClip(name,trackId,start,duration);
  clip.motion = createDefaultMotionLayerDefinition('shape', { primitive: 'rectangle', size: { w: width, h: height } });
  clip.motion.appearance!.items = [
    { id:nativeId(),kind:'color-fill',name:'Plate',visible:true,opacity:.88,color:rgb('#04121c') },
    { id:nativeId(),kind:'stroke',name:'Border / connector',visible:true,opacity:1,color:rgb(color),width:stroke,alignment:'inside' },
  ];
  return clip;
}
export function nativeText(name: string, trackId: string, start: number, duration: number, text: string, color: string,
  x: number, y: number, width: number, height: number, size: number): SerializableClip {
  const clip=nativeClip(name,trackId,start,duration);
  clip.sourceType='text';
  clip.textProperties={...DEFAULT_TEXT_PROPERTIES,text,fontFamily:'monospace',fontWeight:700,fontSize:size,color,
    boxEnabled:true,boxX:x,boxY:y,boxWidth:width,boxHeight:height,wrapMode:'none',textAlign:'left',verticalAlign:'middle'};
  return clip;
}

/** Compact, shared ordinary text/shape compositions. Timing stays on parent clips. */
export function nativeCardTimeline(side: string, option: number, confidence: number, rejected: boolean, duration: number): CompositionTimelineData {
  const textTrack=nativeTrack('Editable analysis text'), frameTrack=nativeTrack('Editable card border');
  const color=FOOTPRINT_COLORS[rejected?'rejected':'analysing'];
  const score=Math.round((rejected ? .24+(option*.17)% .11 : confidence)*100);
  const title=`${side} ${option+1} ${rejected?'REJECT':option%2?'SLOPE':'GRIP'}`;
  const detail=`${rejected?(option%2?'EDGE':'SLIP'):'CHECK'}       ${score}%`;
  const frame=nativeRectangle('Analysis plate',frameTrack.id,0,duration,508,180,color,5);
  const titleClip=nativeText('Analysis title',textTrack.id,0,duration,title,color,20,14,472,58,42);
  const detailClip=nativeText('Confidence / reason',textTrack.id,0,duration,detail,rejected?color:'#d9f5ff',20,77,472,57,35);
  const progress=nativeRectangle('Analysis progress',frameTrack.id,0,duration,460,5,color,0);
  progress.transform.position.y=71/(CARD_SIZE.height/2);
  progress.motion!.appearance!.items=[{id:nativeId(),kind:'color-fill',name:'Progress',visible:true,opacity:.7,color:rgb(color)}];
  if(!rejected) progress.keyframes=[nativeKey(progress,'scale.x',0,.08),nativeKey(progress,'scale.x',duration,1)];
  return layeredGraphicsTimeline([frame,progress,titleClip,detailClip],duration);
}

export function nativeBannerTimeline(width:number,height:number,duration:number, interlude?:{start:number;end:number;dropMeters:number;dropGreaterThan?:boolean}): CompositionTimelineData {
  const textTrack=nativeTrack('HUD text'), frameTrack=nativeTrack('HUD plates / measurement');
  const clips:SerializableClip[]=[];
  const blue=FOOTPRINT_COLORS.analysing,red=FOOTPRINT_COLORS.rejected;
  const plate=nativeRectangle('Terrain banner build',frameTrack.id,0,duration,width*.89,height*.062,blue,3);
  plate.transform.position.y=2*(.083-.5);
  plate.keyframes=[nativeKey(plate,'scale.x',0,.001),nativeKey(plate,'scale.x',.36,1),nativeKey(plate,'opacity',0,0),nativeKey(plate,'opacity',.36,.8)];
  clips.push(plate);
  const title=nativeText('ANALYSING TERRAIN',textTrack.id,.20,duration-.20,'ANALYSING TERRAIN','#d9f5ff',width*.083,height*.058,width*.84,height*.031,width*.040);
  nativeFade(title,.44,.12);clips.push(title);
  const detail=nativeText('CONTACT SEARCH',textTrack.id,.48,duration-.48,'CONTACT SEARCH',blue,width*.083,height*.087,width*.7,height*.018,width*.021);
  nativeFade(detail,.22,.12);clips.push(detail);
  for(let i=0;i<4;i++){
    const status=nativeRectangle(`Activity ${i+1}`,frameTrack.id,.48,duration-.48,width*.023,height*.006,blue,0);
    status.transform.position={...status.transform.position,x:2*(.79+i*.034-.5),y:2*(.094-.5)};
    status.motion!.appearance!.items=[{id:nativeId(),kind:'color-fill',name:'LED',visible:true,opacity:1,color:rgb(blue)}];
    status.keyframes=[];
    for(let t=0;t<status.duration;t+=1/3)status.keyframes.push(nativeKey(status,'opacity',t,Math.round(t*3)%4===i?.95:.18));
    clips.push(status);
  }
  if(interlude){
    const start=interlude.start,end=Math.min(duration,interlude.end+.45);
    const wonder=nativeText('WONDERFUL',textTrack.id,start+.08,end-start-.08,'WONDERFUL','#ddfaff',width*.18,height*.204,width*.7,height*.052,width*.071);
    nativeFade(wonder,.17,.3);clips.push(wonder);
    const dangerStart=start+1.3;
    const danger=nativeText('DANGER',textTrack.id,dangerStart,end-dangerStart,'DANGER',red,width*.30,height*.737,width*.5,height*.06,width*.08);
    const dangerPlate=nativeRectangle('Danger alarm plate',frameTrack.id,dangerStart,end-dangerStart,width*.60,height*.072,red,5);
    dangerPlate.transform.position.y=.54;
    for(const item of [danger,dangerPlate]){
      item.keyframes=[];
      for(let t=0;t<item.duration-.3;t+=.125)item.keyframes.push(nativeKey(item,'opacity',t,Math.floor(t/.25)%2===0?1:.12));
      item.keyframes.push(nativeKey(item,'opacity',Math.max(0,item.duration-.3),1),nativeKey(item,'opacity',item.duration,0));
      clips.push(item);
    }
    const measureStart=start+.6;
    const measure=nativeText('Drop measurement',textTrack.id,measureStart,end-measureStart,`${interlude.dropGreaterThan?'>':''}${interlude.dropMeters} meter`,blue,width*.66,height*.47,width*.30,height*.07,width*.044);
    nativeFade(measure,.2,.2);clips.push(measure);
    const line=nativeRectangle('Depth ruler',frameTrack.id,measureStart,end-measureStart,4,height*.41,blue,0);
    line.transform.position={...line.transform.position,x:.24,y:-.03};
    line.motion!.appearance!.items=[{id:nativeId(),kind:'color-fill',name:'Ruler',visible:true,opacity:1,color:rgb(blue)}];
    line.keyframes=[nativeKey(line,'scale.y',0,.001),nativeKey(line,'scale.y',.8,1)];nativeFade(line,.2,.2);clips.push(line);
    for(let i=0;i<9;i++){
      const tick=nativeRectangle(`Ruler tick ${i}`,frameTrack.id,measureStart+i*.08,end-measureStart-i*.08,width*(i%2?.02:.03),3,blue,0);
      tick.motion!.appearance!.items=structuredClone(line.motion!.appearance!.items);
      tick.transform.position={...tick.transform.position,x:.24,y:2*(.28+i*.41/8-.5)};
      nativeFade(tick,.04,.2);clips.push(tick);
    }
  }
  return layeredGraphicsTimeline(clips.filter(clip=>clip.duration>0),duration);
}
