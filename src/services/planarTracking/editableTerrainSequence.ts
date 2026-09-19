import { useMediaStore } from '../../stores/mediaStore';
import { useTimelineStore } from '../../stores/timeline';
import type { Composition } from '../../stores/mediaStore/types';
import type { PlanarTrack } from '../../types/planarTracking';
import type { CompositionTimelineData, TimelineClip, TimelineTrack } from '../../types/timeline';
import type { TerrainAttachment } from '../../types/terrainAttachment';
import type { Keyframe } from '../../types/keyframes';
import { clonePlanarTracks } from './clonePlanarTracks';
import { surfaceSourceTime } from './surfaceEffects';
import { buildNativeTerrainSchedule } from './nativeTerrainSchedule';
import { FOOTPRINT_SIZE, FOOTPRINT_COLORS, nativeFootprintVariant, nativeSoleVariant, type NativeFootprintPhase } from './nativeFootprintDesign';
import { CARD_SIZE, nativeBannerTimeline, nativeCardTimeline, nativeClip, nativeFade, nativeId, nativeKey, nativeRectangle, nativeTrack } from './nativeTerrainGraphics';
import { layerBuilder } from '../layerBuilder';
import { renderHostPort } from '../render/renderHostPort';
import { useHistoryStore } from '../../stores/historyStore';

function sourceToTimeline(target: TimelineClip, source: number, keys: readonly Keyframe[]): number {
  let low=0,high=target.duration;
  for(let i=0;i<36;i++){
    const mid=(low+high)/2;
    if(surfaceSourceTime(target,mid,keys)<source)low=mid;else high=mid;
  }
  return target.startTime+(low+high)/2;
}

/** Materialize the existing HUD choreography as ordinary, editable composition clips. */
export async function createEditableTerrainSequence(input:{targetVideoClipId:string;track:PlanarTrack}):Promise<{composition:Composition;events:number;contacts:number}> {
  const timeline=useTimelineStore.getState(),media=useMediaStore.getState();
  const target=timeline.clips.find(clip=>clip.id===input.targetVideoClipId);
  const track=target?.planarTracks?.find(value=>value.id===input.track.id),terrain=track?.terrain;
  const source=media.getActiveComposition();
  if(!target||!track||!terrain?.footsteps?.length||!source)throw new Error('Select the original video and its solved terrain track.');
  const keys=timeline.getClipKeyframes(target.id);
  const sourceStart=surfaceSourceTime(target,0,keys),sourceEnd=surfaceSourceTime(target,target.duration,keys);
  if(sourceEnd<=sourceStart)throw new Error('Create the editable sequence before reversing the source clip.');
  const events=buildNativeTerrainSchedule({steps:terrain.footsteps,denseMesh:terrain.denseMesh,sourceStart,sourceEnd,interlude:track.footstepInterlude});
  const toTime=(time:number)=>sourceToTimeline(target,time,keys);
  const sourceData=timeline.getSerializableState();
  const data:CompositionTimelineData={...sourceData,tracks:sourceData.tracks.map(value=>({...value})),clips:sourceData.clips.map(value=>{
    const {planarTracks,...rest}=value;
    return {...structuredClone(rest),planarTracks:clonePlanarTracks(planarTracks)};
  })};
  const folder=media.createFolder('EDITABLE HIKING HUD');
  const artworkFolder=media.createFolder('Footprints · paths, masks, tread',folder.id);
  const cardFolder=media.createFolder('Analysis cards · text and shapes',folder.id);
  const pending:Composition[]=[];
  const composition=(name:string,width:number,height:number,duration:number,timelineData:Composition['timelineData'],parentId=folder.id):Composition=>{
    const value:Composition={id:nativeId(),name,type:'composition',parentId,createdAt:Date.now(),width,height,frameRate:source.frameRate,
      duration,backgroundColor:'#00000000',timelineData};
    pending.push(value);return value;
  };
  const duration=sourceData.duration;
  const sole=new Map<NativeFootprintPhase,string>();
  for(const phase of ['analysing','rejected','locked'] as const){
    sole.set(phase,composition(`Sole ${phase} · edit Grid Replicators`,FOOTPRINT_SIZE.width,FOOTPRINT_SIZE.height,duration,
      nativeSoleVariant(duration,phase),artworkFolder.id).id);
  }
  const feet=new Map<string,string>(),cards=new Map<string,string>();
  const cardTracks:TimelineTrack[]=[],lineTracks:TimelineTrack[]=[],footTracks:TimelineTrack[]=[];
  const laneEnds:number[]=[];
  function lane(start:number,end:number):number{
    let index=laneEnds.findIndex(value=>value<=start+.00001);
    if(index<0){index=laneEnds.length;cardTracks.push(nativeTrack(`Analysis ${index+1} · cards`));lineTracks.push(nativeTrack(`Analysis ${index+1} · connectors`));footTracks.push(nativeTrack(`Option ${index+1} · footprints`));}
    laneEnds[index]=end;return index;
  }
  let count=0,contacts=0;
  // Interval packing needs chronological starts even when schedule events are grouped by step.
  for(const event of events.toSorted((a,b)=>a.sourceStart-b.sourceStart)){
    if(!('step' in event))continue;
    const start=toTime(event.sourceStart),end=toTime(event.sourceEnd);
    if(end-start<.001)continue;
    const index=lane(start,end);
    const accepted=event.kind==='accepted-step';
    const change=accepted?event.lockTime:event.rejectTime;
    const split=change===null?end:Math.max(start,Math.min(end,toTime(change)));
    const attachment:TerrainAttachment={version:1,targetVideoClipId:target.id,trackId:track.id,footstepId:event.step.id,placement:structuredClone(event.placement),visible:true};
    const stages:{phase:NativeFootprintPhase;start:number;end:number}[]=[{phase:'analysing',start,end:split}];
    if(split<end)stages.push({phase:accepted?'locked':'rejected',start:split,end});
    if(accepted)contacts++;
    for(const stage of stages){
      if(stage.end-stage.start<.001)continue;
      const footKey=`${event.step.id}:${stage.phase}`;
      let footId=feet.get(footKey);
      if(!footId){
        footId=composition(`${event.step.name} · ${stage.phase}`,FOOTPRINT_SIZE.width,FOOTPRINT_SIZE.height,duration,
          nativeFootprintVariant(event.placement,sole.get(stage.phase)!,duration,stage.phase),artworkFolder.id).id;
        feet.set(footKey,footId);
      }
      const side=event.placement.side==='left'?'L':'R';
      const foot=nativeClip(`${side} ${stage.phase.toUpperCase()} · ${event.step.name}`,footTracks[index].id,stage.start,stage.end-stage.start);
      foot.sourceType='video';foot.isComposition=true;foot.compositionId=footId;foot.terrainAttachment=attachment;
      const fadesOut=stage.phase==='rejected'||(stage.phase==='analysing'&&change===null);
      if(fadesOut)nativeFade(foot,stage.phase==='rejected'?0:.06,Math.min(.14,foot.duration*.35));
      else if(stage.phase==='analysing')foot.keyframes=[nativeKey(foot,'opacity',0,.1),nativeKey(foot,'opacity',Math.min(.07,foot.duration*.3),.85)];
      data.clips.push(foot);
      if(stage.phase==='locked')continue;
      const option='candidateIndex' in event?event.candidateIndex:0;
      const rejected=stage.phase==='rejected';
      // Confidence buckets share small native cards instead of allocating full-frame textures per probe.
      const confidence=Math.round((event.confidence??.9)*20)/20;
      const cardKey=`${side}:${option}:${confidence}:${rejected}`;
      let cardId=cards.get(cardKey);
      if(!cardId){cardId=composition(`${side} option ${option+1} · ${rejected?'REJECT':'CHECK'} · ${Math.round(confidence*100)}%`,CARD_SIZE.width,CARD_SIZE.height,1,
        nativeCardTimeline(side,option,confidence,rejected,1),cardFolder.id).id;cards.set(cardKey,cardId);}
      const card=nativeClip(`${side} ${rejected?'REJECT':'ANALYSE'} · option ${option+1}`,cardTracks[index].id,stage.start,foot.duration);
      card.sourceType='video';card.isComposition=true;card.compositionId=cardId;
      card.speed=1/card.duration;card.inPoint=0;card.outPoint=1;card.naturalDuration=1;
      // Distribute tracked cards above the contact; independent XY remains editable.
      card.terrainScreenAnchor={attachment,offset:{x:(index%3-1)*.21,y:-.19-Math.floor(index/3)*.065},contentBounds:{left:.12,right:.88,top:.16,bottom:.85},
        labelLayout:{group:'terrain-options',width:.193,height:.193*CARD_SIZE.height/CARD_SIZE.width*source.width/source.height}};
      card.transform.scale.x=card.transform.scale.y=source.width*.193/CARD_SIZE.width;
      nativeFade(card,rejected?0:.06,Math.min(.1,card.duration*.3));
      const connector=nativeRectangle(`${side} connector · option ${option+1}`,lineTracks[index].id,stage.start,foot.duration,10,10,FOOTPRINT_COLORS[stage.phase],4.5);
      connector.terrainAnchorConnector={anchorClipId:card.id,color:FOOTPRINT_COLORS[stage.phase],width:4.5,opacity:.85};
      nativeFade(connector,rejected?0:.06,Math.min(.1,connector.duration*.3));
      data.clips.push(card,connector);
    }
    count++;
  }
  const bannerTrack=nativeTrack('HUD · titles and scenic interlude');
  const interlude=track.footstepInterlude?{...track.footstepInterlude,start:toTime(track.footstepInterlude.start)-target.startTime,end:toTime(track.footstepInterlude.end)-target.startTime}:undefined;
  const bannerComp=composition('HUD banners · editable text, build and alarm',source.width,source.height,target.duration,
    nativeBannerTimeline(source.width,source.height,target.duration,interlude));
  const banner=nativeClip('HUD · ANALYSING / WONDERFUL / DANGER',bannerTrack.id,target.startTime,target.duration);
  banner.sourceType='video';banner.isComposition=true;banner.compositionId=bannerComp.id;
  data.tracks=[bannerTrack,...cardTracks,...lineTracks,...footTracks,...data.tracks];
  data.clips.push(banner);
  data.clips=data.clips.map(value=>value.id!==target.id?value:{...value,planarTracks:value.planarTracks?.map(valueTrack=>valueTrack.id!==track.id?valueTrack:{...valueTrack,enabled:false})});
  // Keep the existing authored audio stems once; no duplicated synthetic lock cue.
  const output=composition('HIKING HUD · FULL EDITABLE',source.width,source.height,duration,data);
  // Install all pure composition data in one store update, avoiding hundreds of save/history notifications.
  useMediaStore.setState(state=>({compositions:[...state.compositions,...pending]}));
  layerBuilder.invalidateCache();renderHostPort.requestRender();
  await useMediaStore.getState().openCompositionTab(output.id,{skipAnimation:true});
  useHistoryStore.getState().captureSnapshot('Create editable terrain HUD');
  return {composition:output,events:count,contacts};
}
