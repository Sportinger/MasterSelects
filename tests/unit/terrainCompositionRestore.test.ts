import { describe,it,expect,vi } from 'vitest';
vi.mock('../../src/services/project/relinkMedia',()=>({mediaNeedsRelink:()=>false}));
vi.mock('../../src/stores/timeline/nestedCompositionLoader',()=>({calculateNestedClipBoundaries:vi.fn(),loadNestedClips:vi.fn(),scheduleNestedClipSegmentBuild:vi.fn()}));
vi.mock('../../src/stores/timeline/nestedRestore',()=>({restorePersistedClipVideoState:()=>undefined}));
vi.mock('../../src/services/nodeGraph',()=>({cloneClipNodeGraph:()=>undefined}));
vi.mock('../../src/transitions',()=>({normalizeTransitionInstanceParams:(x:unknown)=>x}));
import { restoreLoadStateCompositionClip } from '../../src/stores/timeline/serialization/loadStateCompositionClipRestore';

describe('terrain composition restore',()=>{
  it('retains attachment and screen anchor when opening a composition clip',async()=>{
    const attachment={version:1,targetVideoClipId:'video',trackId:'terrain',visible:true,placement:{x:0,y:0,width:1,height:2,rotation:0}};
    const trackingBinding={version:1,assetId:'asset',targetVideoClipId:'video',mode:'surface',point:{x:.5,y:.5},offset:{x:0,y:0},placement:{x:.4,y:.6,width:.2,height:.1,rotation:7}};
    const source:any={id:'nested',name:'Foot',trackId:'track',isComposition:true,compositionId:'design',sourceType:'video',duration:3,inPoint:0,outPoint:3,startTime:0,trackingBinding,terrainAttachment:attachment,terrainScreenAnchor:{attachment,offset:{x:0,y:-.1}}};
    const push=vi.fn();
    await restoreLoadStateCompositionClip({serializedClip:source,mediaStore:{compositions:[{id:'design'}]} as any,
      get:vi.fn(),set:vi.fn(),pushRestoredClip:push,flushRestoredClipBuffer:vi.fn(),isCurrentTimelineSession:()=>true,wakePreviewAfterRestore:vi.fn(),restoreSourceThumbnails:vi.fn()});
    const restored=push.mock.calls[0][0];
    expect(restored.terrainAttachment).toEqual(attachment);
    expect(restored.terrainAttachment).not.toBe(attachment);
    expect(restored.terrainScreenAnchor).toEqual(source.terrainScreenAnchor);
    expect(restored.trackingBinding).toEqual(trackingBinding);
    expect(restored.trackingBinding).not.toBe(trackingBinding);
  });
});
