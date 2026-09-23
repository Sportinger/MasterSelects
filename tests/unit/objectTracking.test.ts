import { refineObjectSamples } from '../../src/services/objectTracking/objectRefinement';
import { trackingTimelineTime } from '../../src/services/planarTracking/trackingTimelineTime';
import { describe, expect, it } from 'vitest';
import { contourBounds, maskContour, simplifyContour, validContour } from '../../src/services/objectTracking/objectContour';
import { clonePlanarTracks } from '../../src/services/planarTracking/clonePlanarTracks';
import { surfaceEffectForFrame } from '../../src/services/planarTracking/surfaceEffects';
import { surfaceOverlay } from '../../src/effects/tracking/surfaceOverlay';
import type { PlanarTrack } from '../../src/types/planarTracking';
import type { TimelineClip } from '../../src/types/timeline';
import { objectMaskKeys } from '../../src/services/objectTracking/objectMask';
import { objectEnclosure } from '../../src/services/objectTracking/objectEnclosure';
import { getInterpolatedMaskPathValue } from '../../src/stores/timeline/keyframes/pathKeyframeValues';

const outline=[{x:.2,y:.2},{x:.5,y:.1},{x:.8,y:.2},{x:.8,y:.8},{x:.5,y:.9},{x:.2,y:.8}];
const track:PlanarTrack={id:'object',name:'Rider',sourceId:'source',fps:24,referenceTime:2,referenceQuad:contourBounds(outline),object:{referenceContour:outline,detailContour:outline},samples:[{time:2,duration:.04,quad:contourBounds(outline),contour:outline,confidence:1}],occlusions:[],enabled:true,color:'#50c8ff',opacity:1,fill:0,lineWidth:2,inset:0,shape:'outline',visibleFrom:0,visibleTo:3,fade:0};
describe('object contours',()=>{
  it('keeps a coarse padded outline outside the entire silhouette instead of clipping wheels',()=>{
    const detail=Array.from({length:48},(_,i)=>({x:.5+Math.cos(i*Math.PI/24)*.3,y:.5+Math.sin(i*Math.PI/24)*.4}));
    for(const count of [4,6,8]) {
      const enclosure=objectEnclosure(detail,count,.04);expect(validContour(enclosure)).toBe(true);expect(enclosure).toHaveLength(count);
      for(const p of detail)enclosure.forEach((a,i)=>{const b=enclosure[(i+1)%enclosure.length];expect((b.x-a.x)*(p.y-a.y)-(b.y-a.y)*(p.x-a.x)).toBeGreaterThanOrEqual(-1e-9);});
    }
  });
  it('preserves ordered shapes when adding points and rejects crossings, duplicates and invalid coordinates',()=>{
    const more=simplifyContour(outline,16);expect(more).toHaveLength(16);expect(validContour(more)).toBe(true);
    expect(validContour(simplifyContour(more,6))).toBe(true);
    expect(validContour([outline[0],outline[2],outline[4],outline[1]])).toBe(false);
    expect(validContour([...outline,outline[0]])).toBe(false);
    expect(validContour([{x:NaN,y:.2},...outline.slice(1)])).toBe(false);
    expect(outline).toHaveLength(6);
  });
  it('traces only the clicked component and preserves concavity in the detailed mask',()=>{
    const width=100,height=80,mask=new Uint8Array(width*height);
    for(let y=10;y<60;y++)for(let x=10;x<50;x++)if(x<25||y>40)mask[y*width+x]=255;
    for(let y=10;y<50;y++)for(let x=70;x<90;x++)mask[y*width+x]=255;
    const contour=maskContour(mask,width,height,{x:.15,y:.2});
    expect(validContour(contour)).toBe(true);expect(contourBounds(contour)).toEqual([{x:.1,y:.125},{x:.5,y:.125},{x:.5,y:.75},{x:.1,y:.75}]);
    expect(contour.some(p=>p.x===.25&&p.y===41/80)).toBe(true);
    expect(()=>maskContour(mask,width,height,{x:.6,y:.5})).toThrow('No object');
  });
  it('keeps editable contours independent across snapshots and JSON persistence',()=>{
    const copy=clonePlanarTracks([track])!;
    expect(JSON.parse(JSON.stringify(copy))).toEqual([track]);
    copy[0].object!.detailContour[0].x=.99;copy[0].samples[0].contour![1].x=.99;
    expect(track.object!.detailContour[0].x).toBe(.2);expect(track.samples[0].contour![1].x).toBe(.5);
  });
  it('packs the same frame-held contour for preview/export and hides coverage gaps',()=>{
    const effect=surfaceEffectForFrame(track,2.02)!;
    expect(effect.params.contourCount).toBe(6);
    const buffer=surfaceOverlay.packUniforms!(effect.params,1920,1080) as Float32Array;
    expect(buffer.byteLength).toBe(surfaceOverlay.uniformSize);expect(buffer[23]).toBe(6);
    outline.forEach((p,i)=>{expect(buffer[32+i*4]).toBeCloseTo(p.x);expect(buffer[33+i*4]).toBeCloseTo(p.y);});
    expect(surfaceEffectForFrame(track,2.05)).toBeNull();expect(surfaceEffectForFrame(track,1.99)).toBeNull();
  });
  it('bakes editable mask paths with empty held paths across gaps and reverse timing',()=>{
    const clip={id:'clip',inPoint:1.9,outPoint:2.2,startTime:0,duration:.3,speed:1} as TimelineClip;
    const keys=objectMaskKeys(clip,track,'mask',100,[]);
    expect(keys.filter(k=>k.pathValue)).toHaveLength(3);
    expect(keys.map(k=>k.pathValue!.vertices.some(v=>v.x>=0)?1:0)).toEqual([0,1,0]);
    expect(keys.every(k=>k.hold)).toBe(true);
    expect(keys.find(k=>k.pathValue?.vertices.some(v=>v.x>=0))!.time).toBeCloseTo(.1);
    const reverse=objectMaskKeys({...clip,speed:-1},track,'mask',100,[]);
    expect(reverse.find(k=>k.pathValue?.vertices.some(v=>v.x>=0))!.time).toBeCloseTo(.17);
    expect(reverse.map(k=>k.pathValue!.vertices.some(v=>v.x>=0)?1:0)).toEqual([0,1,0]);
    const first=keys.find(k=>k.pathValue?.vertices.some(v=>v.x>=0))!;
    const second={...first,id:'next',time:.2,pathValue:{...first.pathValue!,vertices:first.pathValue!.vertices.map(p=>({...p,x:p.x+.05}))}};
    expect(getInterpolatedMaskPathValue([first,second],first.property,.15,first.pathValue!)).toEqual(first.pathValue);
    expect(getInterpolatedMaskPathValue([first,second],first.property,.2,first.pathValue!)).toEqual(second.pathValue);
  });
});

it('keeps user prompts as immutable anchors and tapers corrections into neighboring motion',()=>{
  const samples=Array.from({length:5},(_,time)=>({...track.samples[0],time,manual:false}));
  const manual={...samples[2],manual:true,objectPrompts:[{x:.4,y:.5,label:1 as const}],contour:outline.map(p=>({...p,x:p.x+.06}))};
  const result=refineObjectSamples(samples,[{...samples[0],manual:true},manual,{...samples[4],manual:true}]);
  expect(result[2]).toEqual(manual);expect(result[2]).not.toBe(manual);
  expect(result[1].contour![0].x).toBeCloseTo(outline[0].x+.03);
  expect(result[3].contour![0].x).toBeCloseTo(outline[0].x+.03);
  expect(result[0].contour).toEqual(outline);expect(result[4].contour).toEqual(outline);
  expect(samples[1].contour).toEqual(outline);
  const rerun=refineObjectSamples(samples,result.filter(s=>s.manual));
  expect(JSON.parse(JSON.stringify(rerun[2]))).toEqual(manual);
});
it('returns to the last tracked source frame for forward and reversed clips',()=>{
  const clip={id:'clip',inPoint:1.9,outPoint:2.2,startTime:3,duration:.3,speed:1} as TimelineClip;
  expect(trackingTimelineTime(clip,track.samples[0],[],100,3)).toBeCloseTo(3.1);
  expect(trackingTimelineTime({...clip,speed:-1},track.samples[0],[],100,3)).toBeCloseTo(3.17);
});
