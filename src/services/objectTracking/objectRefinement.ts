import type { SurfacePoint, SurfaceSample } from '../../types/planarTracking';
import { contourBounds, simplifyContour, validContour } from './objectContour';

function aligned(target: SurfacePoint[], reference: SurfacePoint[]): SurfacePoint[] {
  const points = simplifyContour(target, reference.length);
  let best = points, score = Infinity;
  for (const ordered of [points, [...points].reverse()]) {
    for (let offset = 0; offset < points.length; offset++) {
      const candidate = ordered.map((_, i) => ordered[(i + offset) % points.length]);
      const error = candidate.reduce((sum, p, i) => sum + (p.x-reference[i].x)**2 + (p.y-reference[i].y)**2, 0);
      if (error < score) { score = error; best = candidate; }
    }
  }
  return best;
}

/** Apply user anchors to existing optical-flow motion, tapering between anchors. */
export function refineObjectSamples(samples: SurfaceSample[], anchors: SurfaceSample[]): SurfaceSample[] {
  const corrections = anchors.filter(a => a.manual && a.contour).map(anchor => {
    const original = samples.find(s => Math.abs(s.time-anchor.time)<1e-6);
    const base = original?.contour ?? anchor.contour!;
    const target = aligned(anchor.contour!, base);
    return {anchor, base, delta: target.map((p,i)=>({x:p.x-base[i].x,y:p.y-base[i].y}))};
  }).toSorted((a,b)=>a.anchor.time-b.anchor.time);
  if (!corrections.length) return samples;
  const corrected = samples.map(sample => {
    const exact = corrections.find(c => Math.abs(c.anchor.time-sample.time)<1e-6);
    if (exact) return structuredClone(exact.anchor);
    if (!sample.contour || sample.manual) return sample;
    const rightIndex = corrections.findIndex(c=>c.anchor.time>sample.time);
    const left = corrections[Math.max(0,rightIndex<0?corrections.length-1:rightIndex-1)];
    const right = corrections[rightIndex<0?corrections.length-1:rightIndex];
    const weight = left===right?0:(sample.time-left.anchor.time)/(right.anchor.time-left.anchor.time);
    const displacement = (point:SurfacePoint, correction:typeof left) => {
      let closest=0, distance=Infinity;
      correction.base.forEach((p,i)=>{const d=(p.x-point.x)**2+(p.y-point.y)**2;if(d<distance){closest=i;distance=d;}});
      return correction.delta[closest];
    };
    const move = (point:SurfacePoint) => {
      const a=displacement(point,left),b=displacement(point,right);
      return {x:Math.max(0,Math.min(1,point.x+a.x*(1-weight)+b.x*weight)),y:Math.max(0,Math.min(1,point.y+a.y*(1-weight)+b.y*weight))};
    };
    const contour=sample.contour.map(move),detailContour=sample.detailContour?.map(move);
    if(!validContour(contour)||detailContour&&!validContour(detailContour))return sample;
    return {...sample,contour,detailContour,quad:contourBounds(contour)};
  });
  for(const {anchor} of corrections)if(!corrected.some(s=>Math.abs(s.time-anchor.time)<1e-6))corrected.push(structuredClone(anchor));
  return corrected.toSorted((a,b)=>a.time-b.time);
}
