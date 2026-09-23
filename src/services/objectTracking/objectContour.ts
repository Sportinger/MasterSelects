import type { SurfacePoint, SurfaceQuad } from '../../types/planarTracking';

export const MAX_OBJECT_POINTS = 64;
export function contourBounds(points: readonly SurfacePoint[]): SurfaceQuad {
  const x = points.map(p => p.x), y = points.map(p => p.y);
  const left = Math.min(...x), right = Math.max(...x), top = Math.min(...y), bottom = Math.max(...y);
  return [{x:left,y:top},{x:right,y:top},{x:right,y:bottom},{x:left,y:bottom}];
}
const cross = (a: SurfacePoint, b: SurfacePoint, c: SurfacePoint) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
export function validContour(points: readonly SurfacePoint[]): boolean {
  if (points.length < 3 || points.length > MAX_OBJECT_POINTS || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return false;
  let area = 0;
  for (let i=0;i<points.length;i++) {
    const a=points[i], b=points[(i+1)%points.length];
    if (Math.hypot(a.x-b.x,a.y-b.y)<1e-6) return false;
    area += a.x*b.y-a.y*b.x;
    for (let j=i+2;j<points.length;j++) {
      if ((j+1)%points.length===i) continue;
      const c=points[j], d=points[(j+1)%points.length];
      if (cross(a,b,c)*cross(a,b,d)<=0 && cross(c,d,a)*cross(c,d,b)<=0 &&
        Math.max(a.x,b.x)>=Math.min(c.x,d.x) && Math.max(c.x,d.x)>=Math.min(a.x,b.x) &&
        Math.max(a.y,b.y)>=Math.min(c.y,d.y) && Math.max(c.y,d.y)>=Math.min(a.y,b.y)) return false;
    }
  }
  return Math.abs(area)>0.00002;
}

/** Remove the least significant corners, preserving the ordered outer boundary. */
export function simplifyContour(points: readonly SurfacePoint[], count: number): SurfacePoint[] {
  const result=points.map(p=>({...p}));
  count=Math.max(3,Math.min(MAX_OBJECT_POINTS,Math.round(count)));
  while(result.length>count) {
    let best=0, score=Infinity;
    for(let i=0;i<result.length;i++) {
      const a=result[(i+result.length-1)%result.length], b=result[i], c=result[(i+1)%result.length];
      const value=Math.abs(cross(a,b,c));
      if(value<score) {score=value;best=i;}
    }
    result.splice(best,1);
  }
  while(result.length<count && result.length>=3) {
    let best=0, distance=-1;
    for(let i=0;i<result.length;i++) {
      const a=result[i], b=result[(i+1)%result.length], d=Math.hypot(a.x-b.x,a.y-b.y);
      if(d>distance){distance=d;best=i;}
    }
    const a=result[best], b=result[(best+1)%result.length];
    result.splice(best+1,0,{x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  }
  return result;
}

/** Trace the outside of the clicked connected component, retaining a detailed contour. */
export function maskContour(mask: Uint8Array, width: number, height: number, point: SurfacePoint): SurfacePoint[] {
  if(mask.length!==width*height) throw new Error('Invalid selection mask.');
  const start=Math.min(height-1,Math.max(0,Math.floor(point.y*height)))*width+Math.min(width-1,Math.max(0,Math.floor(point.x*width)));
  if(!mask[start]) throw new Error('No object at this point. Click inside the subject.');
  const visited=new Uint8Array(mask.length), queue=new Int32Array(mask.length);
  let end=1; queue[0]=start; visited[start]=1;
  for(let i=0;i<end;i++) {
    const p=queue[i], x=p%width, y=Math.floor(p/width);
    for(const next of [x>0?p-1:-1,x<width-1?p+1:-1,y>0?p-width:-1,y<height-1?p+width:-1]) {
      if(next>=0&&mask[next]&&!visited[next]){visited[next]=1;queue[end++]=next;}
    }
  }
  if(end<16 || end>mask.length*.95) throw new Error('Selection is empty or covers almost the whole image. Try another point.');
  // Clockwise boundary edges with foreground to their right. Separate holes stay separate.
  const edges=new Map<number,number[]>(), stride=width+1;
  const add=(a:number,b:number)=>{const list=edges.get(a)??[];list.push(b);edges.set(a,list);};
  for(let i=0;i<end;i++) {
    const p=queue[i],x=p%width,y=Math.floor(p/width), a=y*stride+x;
    if(y===0||!visited[p-width])add(a,a+1);
    if(x===width-1||!visited[p+1])add(a+1,a+stride+1);
    if(y===height-1||!visited[p+width])add(a+stride+1,a+stride);
    if(x===0||!visited[p-1])add(a+stride,a);
  }
  let longest:SurfacePoint[]=[];
  while(edges.size) {
    const first=edges.keys().next().value!; let current=first;
    const loop:SurfacePoint[]=[];
    do {
      loop.push({x:(current%stride)/width,y:Math.floor(current/stride)/height});
      const next=edges.get(current);if(!next)break;
      const value=next.pop()!;if(!next.length)edges.delete(current);current=value;
    }while(current!==first);
    if(loop.length>longest.length)longest=loop;
  }
  const result=simplifyContour(longest,Math.min(64,longest.length));
  if(!validContour(result)) throw new Error('The selected outline is too complex. Choose a clearer frame.');
  return result;
}
