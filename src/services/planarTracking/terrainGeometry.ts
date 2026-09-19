import type { TerrainCamera, TerrainIntrinsics, TerrainVector } from '../../types/terrainTracking';

export function terrainCameraPoint(camera: TerrainCamera, p: TerrainVector): TerrainVector {
  const r = camera.rotation, t = camera.translation;
  return [r[0]*p[0]+r[1]*p[1]+r[2]*p[2]+t[0], r[3]*p[0]+r[4]*p[1]+r[5]*p[2]+t[1], r[6]*p[0]+r[7]*p[1]+r[8]*p[2]+t[2]];
}

export function terrainProject(k: TerrainIntrinsics, p: TerrainVector): [number, number] {
  const x=p[0]/p[2],y=p[1]/p[2],radial=1+(k.k1??0)*(x*x+y*y);
  return [(k.fx*x*radial+k.cx)/k.width, (k.fy*y*radial+k.cy)/k.height];
}

export function terrainRotation(q: number[]): TerrainCamera['rotation'] {
  const length = Math.hypot(...q);
  if (!Number.isFinite(length) || length < 1e-8) throw new Error('Invalid solved camera rotation.');
  const [w,x,y,z] = q.map(value => value/length);
  return [1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)];
}

export function terrainMedian(values: number[]): number {
  return values.length ? values.toSorted((a,b)=>a-b)[Math.floor(values.length/2)] : Infinity;
}

/** Bounded Bowyer-Watson triangulation of reference-view points, retaining real 3D vertices. */
export function triangulateTerrain(points: readonly [number, number][]): number[] {
  if (points.length < 3) return [];
  const p: [number,number][] = [...points, [-100,-100], [100,-100], [0,100]];
  const n = points.length;
  let triangles: [number,number,number][] = [[n,n+1,n+2]];
  const inCircle = (tri: number[], v: [number,number]) => {
    const [a,b,c] = tri.map(i=>p[i]);
    const ax=a[0]-v[0], ay=a[1]-v[1], bx=b[0]-v[0], by=b[1]-v[1], cx=c[0]-v[0], cy=c[1]-v[1];
    const det=(ax*ax+ay*ay)*(bx*cy-by*cx)-(bx*bx+by*by)*(ax*cy-ay*cx)+(cx*cx+cy*cy)*(ax*by-ay*bx);
    const orientation=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    return orientation>0 ? det>1e-12 : det< -1e-12;
  };
  for (let i=0;i<n;i++) {
    const bad=triangles.filter(t=>inCircle(t,p[i]));
    const edges=new Map<string,{a:number;b:number;count:number}>();
    for(const t of bad) for(let e=0;e<3;e++) {
      const a=t[e], b=t[(e+1)%3], key=`${Math.min(a,b)}:${Math.max(a,b)}`;
      const edge=edges.get(key); if(edge)edge.count++;else edges.set(key,{a,b,count:1});
    }
    const removed=new Set(bad); triangles=triangles.filter(t=>!removed.has(t));
    for(const {a,b,count} of edges.values()) if(count===1)triangles.push([a,b,i]);
  }
  return triangles.filter(t=>t.every(i=>i<n)).flat();
}
