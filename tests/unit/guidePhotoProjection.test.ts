import { describe, expect, it } from 'vitest';
import type { ClipTransform } from '../../src/types/timelineCore';
import { guidePhotoProjection } from '../../src/components/panels/properties/perspectiveGuides/guidePhotoProjection';

const transform = (): ClipTransform => ({position:{x:0,y:0,z:0},scale:{all:1,x:1,y:1},rotation:{x:0,y:0,z:0},opacity:1});
describe('guide photo coordinates in Preview', () => {
  it('preserves native photo pixels in a differently sized composition', () => {
    const p = guidePhotoProjection(4000,2000,{width:1000,height:1000},transform());
    const pixels = p.canvasPoint(.6,.7);
    expect(pixels[0]).toBeCloseTo(900); expect(pixels[1]).toBeCloseTo(900);
    const [x,y] = p.sourcePoint(.9,.9);
    expect(x).toBeCloseTo(.6); expect(y).toBeCloseTo(.7);
  });
  it('includes uniform scale, placement, anchor and degree-based rotation, with reversible coordinates', () => {
    const t=transform(); t.scale={all:.5,x:1,y:1}; t.position={x:.2,y:-.1,z:0}; t.rotation.z=90;
    const p=guidePhotoProjection(4000,2000,{width:1000,height:1000},t);
    const [x,y]=p.canvasPoint(.6,.7);
    expect(x).toBeCloseTo(800); expect(y).toBeCloseTo(250);
    t.anchor={x:.1,y:-.2,z:0};
    const anchored=guidePhotoProjection(4000,2000,{width:1000,height:1000},t);
    const center=anchored.canvasPoint(.6,.3);
    expect(center[0]).toBeCloseTo(600); expect(center[1]).toBeCloseTo(450);
    for(const [u,v] of [[0,0],[.3,.8],[1,1]]) {
      const point=anchored.canvasPoint(u,v), back=anchored.sourcePoint(point[0]/1000,point[1]/1000);
      expect(back[0]).toBeCloseTo(u); expect(back[1]).toBeCloseTo(v);
    }
  });
  it('rejects unsupported tilted placement and zero scale explicitly', () => {
    const t=transform(); t.rotation.x=20;
    expect(()=>guidePhotoProjection(4000,2000,{width:1000,height:1000},t)).toThrow('2D placement');
    t.rotation.x=0; t.scale.all=0;
    expect(()=>guidePhotoProjection(4000,2000,{width:1000,height:1000},t)).toThrow('nonzero');
  });
});
