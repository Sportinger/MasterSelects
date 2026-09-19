import { describe, expect, it } from 'vitest';
import { trackingPreviewTransform } from '../../src/services/planarTracking/trackingPreviewTransform';
import { trackingCoverage } from '../../src/services/planarTracking/trackingCoverage';
import type { ClipTransform } from '../../src/types/timelineCore';
import type { PlanarTrack } from '../../src/types/planarTracking';

const identity:ClipTransform={position:{x:0,y:0,z:0},scale:{x:1,y:1},rotation:{x:0,y:0,z:0},opacity:1,blendMode:'normal'};
describe('tracking preview source coordinates',()=>{
  it('places native source pixels inside a larger composition',()=>{
    const m=trackingPreviewTransform(identity,{width:960,height:540},{width:1920,height:1080});
    expect(m.toComposition({x:0,y:0})).toEqual({x:.25,y:.25});
    expect(m.toComposition({x:1,y:1})).toEqual({x:.75,y:.75});
  });
  it('round-trips a tilted, rotated, anchored, nonuniformly scaled source',()=>{
    const m=trackingPreviewTransform({...identity,position:{x:.2,y:-.1,z:.12},anchor:{x:.1,y:-.1,z:0},scale:{all:.8,x:1.7,y:.6},rotation:{x:12,y:-19,z:42}},{width:2160,height:3840},{width:1920,height:1080});
    for(const point of [{x:0,y:0},{x:1,y:1},{x:.2,y:.8}]){
      const actual=m.toSource(m.toComposition(point));expect(actual.x).toBeCloseTo(point.x,8);expect(actual.y).toBeCloseTo(point.y,8);
    }
  });
  it('keeps coverage gaps visible instead of joining first and last timestamps',()=>{
    const track={fps:30,samples:[{time:0,duration:.1},{time:.1,duration:.1},{time:1,duration:.1}]} as PlanarTrack;
    expect(trackingCoverage(track)).toEqual([{from:0,to:.2},{from:1,to:1.1}]);
  });
});
