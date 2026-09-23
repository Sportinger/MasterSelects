import type { SurfacePoint } from '../../types/planarTracking';
import { contourBounds, simplifyContour, validContour } from './objectContour';

const cross=(a:SurfacePoint,b:SurfacePoint,c:SurfacePoint)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const area=(points:SurfacePoint[])=>Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p.x*q.y-p.y*q.x;},0));
function convexHull(points:readonly SurfacePoint[]) {
  const sorted=points.toSorted((a,b)=>a.x-b.x||a.y-b.y);
  const half=(list:SurfacePoint[])=>{
    const result:SurfacePoint[]=[];
    for(const p of list){while(result.length>1&&cross(result.at(-2)!,result.at(-1)!,p)<=0)result.pop();result.push(p);}
    return result.slice(0,-1);
  };
  return [...half(sorted),...half(sorted.toReversed())];
}
function intersect(a:SurfacePoint,b:SurfacePoint,c:SurfacePoint,d:SurfacePoint):SurfacePoint|null {
  const ux=b.x-a.x,uy=b.y-a.y,vx=d.x-c.x,vy=d.y-c.y,det=ux*vy-uy*vx;
  if(Math.abs(det)<1e-10)return null;
  const t=((c.x-a.x)*vy-(c.y-a.y)*vx)/det;
  return {x:a.x+t*ux,y:a.y+t*uy};
}

/** Coarse selections enclose the silhouette instead of cutting corners off wheels/limbs. */
export function objectEnclosure(detail:readonly SurfacePoint[],count:number,padding=.10):SurfacePoint[] {
  count=Math.max(3,Math.min(64,Math.round(count)));
  let points:SurfacePoint[];
  if(count<=8) {
    points=convexHull(detail);
    while(points.length>count) {
      let best:SurfacePoint[]|undefined,bestArea=Infinity;
      for(let i=0;i<points.length;i++) {
        const ring=[...points.slice(i),...points.slice(0,i)];
        const p=intersect(ring.at(-1)!,ring[0],ring[1],ring[2]);
        if(!p||p.x<0||p.y<0||p.x>1||p.y>1)continue;
        const candidate=[p,...ring.slice(2)];
        if(!validContour(candidate))continue;
        // Keep every original hull vertex inside every candidate half-plane.
        if(points.some(q=>candidate.some((a,j)=>cross(a,candidate[(j+1)%candidate.length],q)<-1e-9)))continue;
        const size=area(candidate);if(size<bestArea){bestArea=size;best=candidate;}
      }
      if(!best){points=contourBounds(detail);break;}
      points=best;
    }
    const [sourceA,,sourceB]=contourBounds(detail),[outerA,,outerB]=contourBounds(points);
    // Nearly parallel support lines must not create a long spike outside the subject.
    if(outerB.x-outerA.x>(sourceB.x-sourceA.x)*1.4||outerB.y-outerA.y>(sourceB.y-sourceA.y)*1.4)points=contourBounds(detail);
    points=simplifyContour(points,Math.max(count,points.length));
  }else points=simplifyContour(detail,count);
  const [a,,b]=contourBounds(detail),cx=(a.x+b.x)/2,cy=(a.y+b.y)/2;
  const amount=Math.max(0,Math.min(.5,Number.isFinite(padding)?padding:0));
  const padded=points.map(p=>({x:Math.max(0,Math.min(1,cx+(p.x-cx)*(1+2*amount))),y:Math.max(0,Math.min(1,cy+(p.y-cy)*(1+2*amount)))}));
  return validContour(padded)?padded:points;
}
