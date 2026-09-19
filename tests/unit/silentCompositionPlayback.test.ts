import { describe, it, expect, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  clips: [] as any[], set: vi.fn(), request: vi.fn(), apply: vi.fn(),
}));
vi.mock('../../src/stores/timeline',()=>({useTimelineStore:{getState:()=>({clips:mocks.clips}),setState:mocks.set}}));
vi.mock('../../src/services/timeline/compositionAudioMixdownCache',()=>({
  getCompositionAudioMixdownKey:(c:any)=>c.nestedContentHash,
  requestCompositionAudioMixdown:mocks.request,
  createCompositionMixdownAudioElement:vi.fn(),
}));
vi.mock('../../src/services/timeline/compositionAudioMixdownTimelineState',()=>({applyCompositionAudioMixdownToTimelineClip:mocks.apply}));
vi.mock('../../src/services/layerBuilder/audioSyncMediaResolver',()=>({resolveAudioSyncMedia:()=>({sourceType:'video'})}));
import { AudioTrackCompositionPlaybackMixdownManager } from '../../src/services/layerBuilder/audioTrackCompositionPlaybackMixdowns';

describe('silent composition playback',()=>{
  it('proves nested graphics silent before starting any audio work or store mutation',()=>{
    mocks.set.mockClear();mocks.request.mockReset();
    const leaf:any={id:'shape',source:{type:'motion-shape'}};
    const inner:any={id:'sole',isComposition:true,compositionId:'sole-comp',nestedClips:[leaf]};
    const clip:any={id:'foot',isComposition:true,compositionId:'foot-comp',source:{type:'video'},nestedClips:[inner]};
    const owner=new AudioTrackCompositionPlaybackMixdownManager();
    for(let i=0;i<1000;i++)owner.ensureCompositionAudioPlaybackElement({...clip,id:`foot-${i}`},'mixdown',[clip]);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it('remembers a silent result without restarting store mutations, and retries changed content',async()=>{
    const clip:any={id:'clip',isComposition:true,compositionId:'comp',nestedContentHash:'v1',source:{type:'video'}};
    mocks.clips=[clip];mocks.set.mockClear();mocks.request.mockReset();
    mocks.request.mockResolvedValue({key:'v1',hasAudio:false});
    const owner=new AudioTrackCompositionPlaybackMixdownManager();
    owner.ensureCompositionAudioPlaybackElement(clip,'mixdown',[clip]);
    await new Promise(resolve=>setTimeout(resolve,0));
    for(let i=0;i<60;i++)owner.ensureCompositionAudioPlaybackElement(clip,'mixdown',[clip]);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.set).toHaveBeenCalledTimes(1);
    const changed={...clip,nestedContentHash:'v2'};mocks.clips=[changed];
    mocks.request.mockResolvedValue({key:'v2',hasAudio:false});
    owner.ensureCompositionAudioPlaybackElement(changed,'mixdown',[changed]);
    await new Promise(resolve=>setTimeout(resolve,0));
    expect(mocks.request).toHaveBeenCalledTimes(2);
  });
});
