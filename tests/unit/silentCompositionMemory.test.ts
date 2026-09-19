import { afterEach, describe, expect, it, vi } from 'vitest';
const mocks=vi.hoisted(()=>({getMediaState:vi.fn(),createBuffer:vi.fn((channels:number,length:number,sampleRate:number)=>({numberOfChannels:channels,length,sampleRate,duration:length/sampleRate}))}));
vi.mock('../../src/stores/mediaStore',()=>({useMediaStore:{getState:mocks.getMediaState}}));
vi.mock('../../src/stores/timeline',()=>({useTimelineStore:{getState:vi.fn()}}));
vi.mock('../../src/engine/audio/AudioMixer',()=>({AudioMixer:class{}}));
vi.mock('../../src/engine/audio/AudioExtractor',()=>({audioExtractor:{}}));
vi.mock('../../src/stores/timeline/helpers/blobUrlManager',()=>({blobUrlManager:{}}));
import { compositionAudioMixer } from '../../src/services/compositionAudioMixer';

describe('silent nested composition memory',()=>{
  afterEach(()=>{compositionAudioMixer.dispose();vi.unstubAllGlobals();});
  it('does not allocate full-duration PCM for hundreds of graphics compositions',async()=>{
    vi.stubGlobal('AudioContext',class{state='running';createBuffer=mocks.createBuffer;close=vi.fn();});
    const compositions=Array.from({length:300},(_,i)=>({id:`graphics-${i}`,name:'Graphics',duration:51,timelineData:{tracks:[{id:'v',type:'video'}],clips:[]}}));
    mocks.getMediaState.mockReturnValue({activeCompositionId:'main',compositions,files:[]});
    mocks.createBuffer.mockClear();
    const results=await Promise.all(compositions.map(c=>compositionAudioMixer.mixdownComposition(c.id)));
    expect(results.every(result=>result?.hasAudio===false&&result.duration===51)).toBe(true);
    expect(new Set(results.map(result=>result!.buffer)).size).toBe(1);
    expect(mocks.createBuffer).toHaveBeenCalledExactlyOnceWith(2,1,48000);
  });
});
