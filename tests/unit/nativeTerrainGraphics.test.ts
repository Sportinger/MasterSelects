import { describe, expect, it } from 'vitest';
import { nativeBannerTimeline, nativeCardTimeline } from '../../src/services/planarTracking/nativeTerrainGraphics';
import { nativeFootprintVariant, nativeSoleVariant } from '../../src/services/planarTracking/nativeFootprintDesign';

describe('editable terrain HUD artwork',()=>{
  it('creates only standard serializable native content, with no zero-duration phase clips',()=>{
    const data=nativeFootprintVariant({x:0,y:0,width:1,height:2,rotation:0,side:'left'},'sole',51,'rejected');
    expect(data.clips.every(clip=>clip.duration>0)).toBe(true);
    expect(data.clips.find(clip=>clip.sourceType==='text')?.textProperties).toMatchObject({text:'L',color:'#ff2929'});
    expect(data.clips.find(clip=>clip.compositionId==='sole')?.masks?.[0].vertices.length).toBeGreaterThan(6);
    expect(nativeSoleVariant(51,'locked').clips.every(clip=>clip.motion?.replicator?.enabled)).toBe(true);
    expect(()=>structuredClone(data)).not.toThrow();
  });
  it('keeps rejected card text and frame red, with readable reason text',()=>{
    const data=nativeCardTimeline('R',2,.92,true,.32);
    expect(data.clips.find(clip=>clip.name==='Analysis title')?.textProperties?.text).toBe('R 3 REJECT');
    expect(data.clips.find(clip=>clip.name==='Confidence / reason')?.textProperties?.text).toContain('SLIP');
    expect(data.clips.every(clip=>['text','motion-shape'].includes(clip.sourceType!))).toBe(true);
    expect(new Set(data.clips.map(clip=>clip.trackId)).size).toBe(data.clips.length);
    expect(data.tracks.at(-1)?.id).toBe(data.clips.find(clip=>clip.name==='Analysis plate')?.trackId);
    expect(data.clips.every(clip=>Math.abs(clip.transform.position.y)<=1)).toBe(true);
  });
  it('builds the initial banner before searches and ends wonder and danger together',()=>{
    const data=nativeBannerTimeline(2160,3840,51,{start:19,end:22,dropMeters:300,dropGreaterThan:true});
    const wonder=data.clips.find(clip=>clip.name==='WONDERFUL')!,danger=data.clips.find(clip=>clip.name==='DANGER')!;
    expect(wonder.startTime+wonder.duration).toBeCloseTo(danger.startTime+danger.duration);
    expect(danger.keyframes!.some(key=>key.value===.12)).toBe(true);
    expect(data.clips.find(clip=>clip.name==='Drop measurement')?.textProperties?.text).toBe('>300 meter');
    expect(data.clips.find(clip=>clip.name==='CONTACT SEARCH')?.startTime).toBe(.48);
    expect(new Set(data.clips.map(clip=>clip.trackId)).size).toBe(data.clips.length);
    const plate=data.clips.find(clip=>clip.name==='Terrain banner build')!;
    expect((plate.transform.position.y+1)/2).toBeCloseTo(.083);
  });
});
