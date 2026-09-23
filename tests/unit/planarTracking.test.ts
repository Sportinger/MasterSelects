import { describe, expect, it } from 'vitest';
import type { PlanarTrack, SurfaceQuad } from '../../src/types/planarTracking';
import { inverseMatrix, mixQuad, projectPoint, quadMatrix, replaceSamples, sampleOcclusion, sampleSurface, validQuad } from '../../src/services/planarTracking/surfaceGeometry';
import { appendSurfaceEffects, resolveSurfaceFrameEffects, surfaceSourceTime } from '../../src/services/planarTracking/surfaceEffects';
import { surfaceFrameIndex } from '../../src/services/planarTracking/surfaceFrameReader';
import { surfaceOverlay } from '../../src/effects/tracking/surfaceOverlay';
import { evaluateCompositionClipEffects } from '../../src/services/compositionRender/keyframeEvaluation';
import { createHistoryTimelineEditState } from '../../src/stores/timeline/historyTimelineEditState';
import { createHistoryTimelineRestoreState } from '../../src/stores/timeline/historyTimelineRestoreState';
import type { TimelineClip } from '../../src/types/timeline';

const quad: SurfaceQuad = [{x:.2,y:.2},{x:.8,y:.3},{x:.7,y:.8},{x:.1,y:.7}];
const next = quad.map(p=>({x:p.x+.02,y:p.y+.01})) as SurfaceQuad;
const track:PlanarTrack={id:'track',name:'Stone',sourceId:'source',fps:30,referenceTime:2,referenceQuad:quad,
  samples:[{time:2,quad,confidence:1},{time:2+1/30,quad:next,confidence:.9}],occlusions:[],enabled:true,color:'#ff3535',opacity:.9,fill:.1,lineWidth:2,inset:0,shape:'outline',visibleFrom:0,visibleTo:4,fade:0};
describe('planar tracking render contract',()=>{
  it('preserves tracking and occlusions through the actual history capture/restore path',()=>{
    const clip={id:'clip',trackId:'video',name:'Ground',startTime:0,duration:4,inPoint:0,outPoint:4,
      source:{type:'video',mediaFileId:'source'},effects:[],transform:{position:{x:0,y:0,z:0},scale:{x:1,y:1},rotation:{x:0,y:0,z:0},opacity:1},
      planarTracks:[{...track,occlusions:[{time:2,quad}]}]} as TimelineClip;
    const captured=createHistoryTimelineEditState({id:'test',label:'Surface edit',timestamp:0,tracks:[],clips:[clip],selectedClipIds:[],zoom:50,scrollX:0});
    const restored=createHistoryTimelineRestoreState(captured,{},{placeholderFileMode:'plain-data'}).state.clips[0];
    expect(restored.planarTracks).toEqual(clip.planarTracks);
    restored.planarTracks![0].samples[0].quad[0].x=.9;
    expect(captured.timeline.clips[0].planarTracks![0].samples[0].quad[0].x).toBe(.2);
    expect(track.samples[0].quad[0].x).toBe(.2);
  });
  it('maps all four corners projectively and rejects crossing geometry',()=>{
    const matrix=quadMatrix(quad),inverse=inverseMatrix(matrix)!;
    const corners=[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
    corners.forEach((p,i)=>{
      const actual=projectPoint(matrix,p);expect(actual.x).toBeCloseTo(quad[i].x,8);expect(actual.y).toBeCloseTo(quad[i].y,8);
      const restored=projectPoint(inverse,actual);expect(restored.x).toBeCloseTo(p.x,8);expect(restored.y).toBeCloseTo(p.y,8);
    });
    expect(validQuad(quad)).toBe(true);expect(validQuad([quad[0],quad[2],quad[1],quad[3]])).toBe(false);
  });
  it('holds the tracked pose throughout a source frame, including slow motion, without inventing gaps',()=>{
    expect(sampleSurface(track,2+1/60)).toBe(track.samples[0]);
    expect(sampleSurface(track,2+1/30)).toBe(track.samples[1]);
    expect(sampleSurface(track,1)).toBeNull();
    expect(sampleSurface({...track,samples:[track.samples[0],{...track.samples[1],time:3}]},2.5)).toBeNull();
    expect(sampleSurface(track,3)).toBeNull();
  });
  it('keeps source coordinates stable through trimming, speed changes, reverse and source replacement',()=>{
    const clip={inPoint:2,outPoint:4,speed:.5,mediaFileId:'source',planarTracks:[track]};
    expect(surfaceSourceTime(clip,1)).toBe(2.5);
    expect(surfaceSourceTime({...clip,speed:-1},1)).toBe(3);
    expect(surfaceSourceTime({...clip,videoInspectorSections:{speedChange:false}},1)).toBe(3);
    expect(appendSurfaceEffects([],clip,1/30)[0].params.x0).toBeCloseTo(.2);
    expect(appendSurfaceEffects([],{...clip,mediaFileId:'replacement'},0)).toEqual([]);
  });
  it('resolves the overlay against the collected texture, even if the playhead advances past track coverage',()=>{
    const clip={inPoint:0,outPoint:8,planarTracks:[track]};
    const layersAtLaterTime=appendSurfaceEffects([],clip,7);
    const held=resolveSurfaceFrameEffects(layersAtLaterTime,2+1/60);
    expect(held[0].params.x0).toBe(.2);
    expect(resolveSurfaceFrameEffects(layersAtLaterTime,2+1/30)[0].params.x0).toBeCloseTo(.22);
    expect(resolveSurfaceFrameEffects(layersAtLaterTime,undefined)).toEqual([]);
    expect(resolveSurfaceFrameEffects(layersAtLaterTime,3)).toEqual([]);
    expect(layersAtLaterTime[0].surfaceTrack).toBe(track);
  });
  it('uses variable presentation durations, handles exact boundaries, and leaves real gaps empty',()=>{
    const timed={...track,samples:[{...track.samples[0],time:0,duration:.04},{...track.samples[1],time:.04,duration:.1},{...track.samples[0],time:.2,duration:.02}]};
    expect(sampleSurface(timed,.039999)).toBe(timed.samples[0]);
    expect(sampleSurface(timed,.04)).toBe(timed.samples[1]);
    expect(sampleSurface(timed,.139999)).toBe(timed.samples[1]);
    expect(sampleSurface(timed,.15)).toBeNull();
    expect(sampleSurface(timed,.22)).toBeNull();
    expect(surfaceFrameIndex(timed.samples,.039999)).toBe(0);
    expect(surfaceFrameIndex(timed.samples,.04)).toBe(1);
    expect(surfaceFrameIndex(timed.samples,-.001)).toBe(-1);
  });
  it('retracking replaces only the selected source range without mutating history',()=>{
    const updated=replaceSamples(track,[{time:2,quad:next,confidence:1,manual:true}],2,2);
    expect(updated.samples).toHaveLength(2);expect(updated.samples[0].quad).toEqual(next);expect(track.samples[0].quad).toEqual(quad);
    expect(JSON.parse(JSON.stringify(updated))).toEqual(updated);
  });
  it('matches container PTS to the same frame after WebCodecs microsecond rounding',()=>{
    const timed={...track,samples:[{...track.samples[0],time:3.9667,duration:1/30},{...track.samples[1],time:4.000033333333,duration:1/30}]};
    expect(sampleSurface(timed,4.000033)).toBe(timed.samples[1]);
    expect(surfaceFrameIndex(timed.samples,4.000033)).toBe(1);
    expect(sampleSurface(timed,4)).toBe(timed.samples[0]);
  });
  it('interpolates occlusion keys and explicitly ends an occlusion',()=>{
    const covered={...track,occlusions:[{time:1,quad},{time:2,quad:next},{time:3,quad:null}]};
    expect(sampleOcclusion(covered,.9)).toBeNull();expect(sampleOcclusion(covered,1.5)).toEqual(mixQuad(quad,next,.5));
    expect(sampleOcclusion(covered,2.9)).toEqual(next);expect(sampleOcclusion(covered,3)).toBeNull();
  });
  it('uses identical source-space effects for nested/export evaluation and packs a finite GPU layout',()=>{
    const clip={inPoint:2,outPoint:4,planarTracks:[track]};
    const effects=appendSurfaceEffects([],clip,0);
    expect(evaluateCompositionClipEffects([],[],0,clip)).toEqual(effects);
    if ('packUniforms' in surfaceOverlay) {
      const buffer=surfaceOverlay.packUniforms(effects[0].params as Record<string,number|boolean|string>,1920,1080)!;
      expect(buffer.byteLength).toBe(1152);expect([...buffer].every(Number.isFinite)).toBe(true);
    }
    expect(appendSurfaceEffects([],{...clip,planarTracks:[{...track,enabled:false}]},0)).toEqual([]);
  });
});
