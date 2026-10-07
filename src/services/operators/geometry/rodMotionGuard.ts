import { closestParameters, ROD_SELF_GAP, type RodSegments } from './rodContacts';

/** Conservative displacement balls for guided rods, including ALL constraint corrections.
 * Each endpoint moves less than half the old segment distance. Convex combinations
 * inherit that bound, so the straight motion between accepted states cannot cross a
 * previously disjoint centre line. Capsule thickness still belongs to contact solve.
 * This cannot repair intersections in the initial geometry or protect later modifiers.
 */
export class RodMotionGuard {
  private readonly bounds: Float64Array;
  private readonly segments: RodSegments;
  private readonly radius: number;
  constructor(segments: RodSegments, radius: number, nodes: number) {
    this.segments = segments;
    this.radius = radius;
    this.bounds = new Float64Array(nodes);
  }

  limit(p: Float64Array, x: Float64Array) {
    const { a, b, rod, arc, rest, rodClosed, rodLength } = this.segments;
    const travel = this.radius * 0.25, reach = 2 * travel / 0.9;
    this.bounds.fill(travel);
    // Midpoint grid sized from actual old lengths, including stretched segments.
    let longest = 0;
    for (let c = 0; c < a.length; c++) longest = Math.max(longest,
      Math.hypot(x[a[c]*3]-x[b[c]*3], x[a[c]*3+1]-x[b[c]*3+1], x[a[c]*3+2]-x[b[c]*3+2]));
    const cell = longest + reach, grid = new Map<string, number[]>(), cells: number[][] = [];
    for (let c = 0; c < a.length; c++) {
      const xyz = [0, 1, 2].map(axis => Math.floor((x[a[c]*3+axis]+x[b[c]*3+axis]) / (2*cell)));
      cells.push(xyz);
      const key = xyz.join(','), bucket = grid.get(key);
      if (bucket) bucket.push(c); else grid.set(key, [c]);
    }
    const d1 = [0,0,0], d2 = [0,0,0], r = [0,0,0], st = [0,0];
    for (let c = 0; c < a.length; c++) {
      const [cx,cy,cz] = cells[c];
      for (let dz=-1; dz<=1; dz++) for (let dy=-1; dy<=1; dy++) for (let dx=-1; dx<=1; dx++) {
        for (const d of grid.get(`${cx+dx},${cy+dy},${cz+dz}`) ?? []) {
          if (d <= c) continue;
          if (rod[c] === rod[d]) {
            let gap = Math.abs(arc[c]-arc[d]);
            if (rodClosed[rod[c]]) gap = Math.min(gap, rodLength[rod[c]]-gap);
            if (gap-(rest[c]+rest[d])/2 < ROD_SELF_GAP*this.radius) continue;
          }
          for (let axis=0; axis<3; axis++) {
            d1[axis]=x[b[c]*3+axis]-x[a[c]*3+axis];
            d2[axis]=x[b[d]*3+axis]-x[a[d]*3+axis];
            r[axis]=x[a[c]*3+axis]-x[a[d]*3+axis];
          }
          closestParameters(d1,d2,r,st);
          const distance = Math.hypot(...r.map((v,axis)=>v+d1[axis]*st[0]-d2[axis]*st[1]));
          const bound = 0.45 * distance;
          for (const node of [a[c],b[c],a[d],b[d]]) this.bounds[node] = Math.min(this.bounds[node], bound);
        }
      }
    }
    this.constrain(p,x);
  }

  constrain(p: Float64Array, x: Float64Array) {
    for (let node=0; node<this.bounds.length; node++) {
      const at=node*3, dx=p[at]-x[at], dy=p[at+1]-x[at+1], dz=p[at+2]-x[at+2];
      const distance=Math.hypot(dx,dy,dz), bound=this.bounds[node];
      if (distance>bound) {
        const scale=bound/distance;
        p[at]=x[at]+dx*scale; p[at+1]=x[at+1]+dy*scale; p[at+2]=x[at+2]+dz*scale;
      }
    }
  }
}
