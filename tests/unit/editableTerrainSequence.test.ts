import { describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({media:{} as any,timeline:{} as any,save:vi.fn()}));
vi.mock('../../src/stores/mediaStore',()=>({useMediaStore:{getState:()=>mocks.media,setState:(update:any)=>Object.assign(mocks.media,update(mocks.media))}}));
vi.mock('../../src/stores/timeline',()=>({useTimelineStore:{getState:()=>mocks.timeline}}));
vi.mock('../../src/stores/historyStore',()=>({useHistoryStore:{getState:()=>({captureSnapshot:mocks.save})}}));
vi.mock('../../src/services/layerBuilder',()=>({layerBuilder:{invalidateCache:vi.fn()}}));
vi.mock('../../src/services/render/renderHostPort',()=>({renderHostPort:{requestRender:vi.fn()}}));
import { createEditableTerrainSequence } from '../../src/services/planarTracking/editableTerrainSequence';
import { DEFAULT_TRANSFORM } from '../../src/stores/timeline/constants';

describe('full editable terrain sequence',()=>{
  it('materializes every contact as normal composition clips and retains source audio exactly once',async()=>{
    const mesh={positions:[-1,-1,3,1,-1,3,0,1,3],indices:[0,1,2],origin:[0,0,3],axisX:[1,0,0],axisY:[0,1,0],normal:[0,0,-1],size:[2,2]};
    const track:any={id:'terrain',enabled:true,terrain:{version:1,solver:'colmap-openmvs',denseMesh:mesh,cameras:[],vertices:[],triangles:[],footsteps:
      Array.from({length:55},(_,i)=>({id:`step-${i}`,name:`Contact ${i}`,placement:{x:0,y:0,width:.1,height:.2,rotation:0,side:i%2?'left':'right',contactTime:1.5+i*.8}}))}};
    const video:any={id:'video',trackId:'v',mediaFileId:'source',name:'Hike',startTime:0,duration:51,inPoint:0,outPoint:51,sourceType:'video',transform:structuredClone(DEFAULT_TRANSFORM),effects:[],planarTracks:[track]};
    const audio={...video,id:'audio',trackId:'a',sourceType:'audio',planarTracks:undefined,name:'Original authored HUD audio'};
    const data:any={tracks:[{id:'v',type:'video',name:'Video'},{id:'a',type:'audio',name:'Audio'}],clips:[video,audio],duration:51,zoom:45,scrollX:0,playheadPosition:0};
    const original=structuredClone(data);
    const source={id:'source-comp',width:2160,height:3840,duration:51,frameRate:30,timelineData:data};
    mocks.media={compositions:[source],getActiveComposition:()=>source,createFolder:(name:string)=>({id:name}),openCompositionTab:vi.fn(async()=>{})};
    mocks.timeline={clips:[video,audio],getClipKeyframes:()=>[],getSerializableState:()=>data};
    const result=await createEditableTerrainSequence({targetVideoClipId:'video',track});
    expect(result.contacts).toBe(55);
    expect(result.events).toBeGreaterThan(55);
    const output=result.composition.timelineData!;
    expect(output.clips.filter(clip=>clip.sourceType==='audio')).toHaveLength(1);
    expect(output.clips.every(clip=>clip.duration>0)).toBe(true);
    const compIds=new Set(mocks.media.compositions.map((comp:any)=>comp.id));
    expect(output.clips.filter(clip=>clip.isComposition).every(clip=>compIds.has(clip.compositionId))).toBe(true);
    expect(output.clips.filter(clip=>clip.terrainAttachment&&clip.name.includes('LOCKED'))).toHaveLength(55);
    expect(output.clips.find(clip=>clip.id==='video')?.planarTracks?.[0].enabled).toBe(false);
    expect(data).toEqual(original);
    expect(mocks.save).toHaveBeenCalledWith('Create editable terrain HUD');
  });
});
