/**
 * Segment topology of a rod simulation: segment `c` joins nodes `a[c]` and `b[c]` of rod `rod[c]`;
 * `arc` is the rest arc length of its midpoint along the rod.
 */
export interface RodSegments {
  a: Uint32Array; b: Uint32Array; rest: Float64Array; rod: Uint32Array; arc: Float64Array;
  rodLength: Float64Array; rodClosed: Uint8Array;
}

/** Segments of one rod closer than this many radii of arc length touch at rest and never collide. */
const SELF_GAP = 2.2;
/**
 * Candidate pairs are gathered with this extra distance (radii) and kept until some node has moved
 * REBUILD radii since: two nodes then close at most half the skin, the other half covers what the
 * solve moves them within a substep (a Verlet list).
 */
const SKIN = 1;
const REBUILD = 0.25;
/** Sliding friction relative to static friction. */
const KINETIC = 0.8;

/** Closest points of segments p1q1 and p2q2 (Ericson, Real-Time Collision Detection 5.1.9). */
function closestParameters(d1: number[], d2: number[], r: number[], out: number[]) {
  const a = d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2], e = d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2];
  const f = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2];
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  let s = 0, t = 0;
  if (a <= 1e-24 && e <= 1e-24) { s = 0; t = 0; }
  else if (a <= 1e-24) t = clamp(f / e);
  else {
    const c = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2];
    if (e <= 1e-24) s = clamp(-c / a);
    else {
      const b = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2], denominator = a * e - b * b;
      s = denominator > 0 ? clamp((b * f - c * e) / denominator) : 0;
      t = (b * s + f) / e;
      if (t < 0) { t = 0; s = clamp(-c / a); } else if (t > 1) { t = 1; s = clamp((b - c) / a); }
    }
  }
  out[0] = s; out[1] = t;
}

/**
 * Capsule contacts between rod segments (thickness 2 × radius) with positional friction
 * (Macklin et al. 2014). Candidates come from a hashed uniform grid sorted by counting sort and are
 * solved in a fixed order. The list depends only on the positions it was built from, which
 * checkpoints keep, so the same state always gives the same result.
 */
export class RodContacts {
  private readonly segments: RodSegments;
  private readonly radius: number;
  private readonly cell: number;
  private readonly mask: number;
  private readonly buckets: Uint32Array;
  private readonly cursor: Uint32Array;
  private readonly entries: Uint32Array;
  private readonly keys: Uint32Array;
  private readonly cells: Int32Array;
  private readonly bounds: Float64Array;
  private readonly stamp: Int32Array;
  private pairsA = new Uint32Array(1024);
  private pairsB = new Uint32Array(1024);
  pairCount = 0;
  private readonly d1 = [0, 0, 0];
  private readonly d2 = [0, 0, 0];
  private readonly r = [0, 0, 0];
  private readonly st = [0, 0];
  /** Node positions the candidate list was built from. */
  private built: Float64Array | null = null;

  constructor(segments: RodSegments, radius: number) {
    this.segments = segments; this.radius = radius;
    const count = segments.a.length;
    let longest = 0;
    for (let c = 0; c < count; c++) longest = Math.max(longest, segments.rest[c]);
    // Midpoints of touching segments lie within one cell of each other, even when slightly stretched.
    this.cell = longest * 1.25 + radius * (2 + SKIN);
    let size = 1;
    while (size < count * 2) size *= 2;
    this.mask = size - 1;
    this.buckets = new Uint32Array(size + 1); this.cursor = new Uint32Array(size);
    this.entries = new Uint32Array(count); this.keys = new Uint32Array(count);
    this.cells = new Int32Array(count * 3); this.bounds = new Float64Array(count * 6);
    this.stamp = new Int32Array(count);
  }

  private hash(x: number, y: number, z: number) {
    return (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & this.mask;
  }

  /** Segments that are neighbours along one rod (within SELF_GAP radii of arc length) never collide. */
  private adjacent(c: number, d: number): boolean {
    const { rod, arc, rest, rodLength, rodClosed } = this.segments;
    if (rod[c] !== rod[d]) return false;
    let distance = Math.abs(arc[c] - arc[d]);
    if (rodClosed[rod[c]]) distance = Math.min(distance, rodLength[rod[c]] - distance);
    return distance - (rest[c] + rest[d]) / 2 < SELF_GAP * this.radius;
  }

  private near(c: number, d: number, reach: number) {
    const { bounds } = this;
    for (let axis = 0; axis < 3; axis++) {
      if (bounds[c * 6 + axis] - reach > bounds[d * 6 + 3 + axis] || bounds[d * 6 + axis] - reach > bounds[c * 6 + 3 + axis]) return false;
    }
    return true;
  }

  private push(c: number, d: number) {
    if (this.pairCount === this.pairsA.length) {
      const a = new Uint32Array(this.pairCount * 2), b = new Uint32Array(this.pairCount * 2);
      a.set(this.pairsA); b.set(this.pairsB); this.pairsA = a; this.pairsB = b;
    }
    this.pairsA[this.pairCount] = c; this.pairsB[this.pairCount] = d; this.pairCount++;
  }

  /** Rebuilds the candidates when a node has moved more than REBUILD radii since the last build. */
  update(p: Float64Array) {
    const built = this.built, limit = (REBUILD * this.radius) ** 2;
    let stale = !built;
    for (let index = 0; built && !stale && index < p.length; index += 3) {
      const dx = p[index] - built[index], dy = p[index + 1] - built[index + 1], dz = p[index + 2] - built[index + 2];
      stale = dx * dx + dy * dy + dz * dz > limit;
    }
    if (!stale) return;
    this.collect(p);
    if (built) built.set(p); else this.built = Float64Array.from(p);
  }

  /** The positions of the last build; restoring them rebuilds the identical list. */
  state(): Float64Array { return this.built!; }
  restore(built: Float64Array) {
    if (this.built) this.built.set(built); else this.built = Float64Array.from(built);
    this.collect(this.built);
  }

  /** Gathers candidate pairs (c < d) whose bounds come within contact distance plus the skin. */
  private collect(p: Float64Array) {
    const { a, b } = this.segments, count = a.length, { cells, bounds, keys, buckets, cursor, entries, stamp, cell } = this;
    buckets.fill(0);
    for (let c = 0; c < count; c++) {
      const i = a[c] * 3, j = b[c] * 3;
      for (let axis = 0; axis < 3; axis++) {
        const u = p[i + axis], v = p[j + axis];
        bounds[c * 6 + axis] = Math.min(u, v); bounds[c * 6 + 3 + axis] = Math.max(u, v);
        cells[c * 3 + axis] = Math.floor((u + v) / 2 / cell);
      }
      keys[c] = this.hash(cells[c * 3], cells[c * 3 + 1], cells[c * 3 + 2]);
      buckets[keys[c] + 1]++;
    }
    for (let key = 0; key <= this.mask; key++) buckets[key + 1] += buckets[key];
    // Counting sort: every bucket lists its segments in index order.
    cursor.set(buckets.subarray(0, this.mask + 1));
    for (let c = 0; c < count; c++) entries[cursor[keys[c]]++] = c;
    stamp.fill(-1);
    const reach = this.radius * (2 + SKIN);
    this.pairCount = 0;
    for (let c = 0; c < count; c++) {
      const cx = cells[c * 3], cy = cells[c * 3 + 1], cz = cells[c * 3 + 2];
      for (let dz = -1; dz <= 1; dz++) {
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const key = this.hash(cx + dx, cy + dy, cz + dz);
            for (let e = buckets[key], end = buckets[key + 1]; e < end; e++) {
              const d = entries[e];
              // Hash collisions can list a segment under two neighbour cells; visit each once.
              if (d <= c || stamp[d] === c) continue;
              stamp[d] = c;
              if (this.near(c, d, reach) && !this.adjacent(c, d)) this.push(c, d);
            }
          }
        }
      }
    }
  }

  /**
   * Pushes overlapping capsules apart along their closest points, then removes the tangential
   * motion of the substep at the contact up to `friction` × penetration (static) or slides
   * with KINETIC × friction. `x` holds the positions at the start of the substep.
   */
  solve(p: Float64Array, x: Float64Array, w: Float64Array, friction: number) {
    const { a, b, rest } = this.segments, { d1, d2, r, st } = this, contact = 2 * this.radius;
    for (let k = 0; k < this.pairCount; k++) {
      const c = this.pairsA[k], d = this.pairsB[k];
      const a0 = a[c] * 3, a1 = b[c] * 3, b0 = a[d] * 3, b1 = b[d] * 3;
      // Bounding spheres around the midpoints (segments stretched up to a quarter) reject most candidates.
      const mx = p[a0] + p[a1] - p[b0] - p[b1], my = p[a0 + 1] + p[a1 + 1] - p[b0 + 1] - p[b1 + 1], mz = p[a0 + 2] + p[a1 + 2] - p[b0 + 2] - p[b1 + 2];
      const bound = (rest[c] + rest[d]) * 1.25 + 2 * contact;
      if (mx * mx + my * my + mz * mz > bound * bound) continue;
      for (let axis = 0; axis < 3; axis++) {
        d1[axis] = p[a1 + axis] - p[a0 + axis]; d2[axis] = p[b1 + axis] - p[b0 + axis]; r[axis] = p[a0 + axis] - p[b0 + axis];
      }
      closestParameters(d1, d2, r, st);
      const s = st[0], t = st[1];
      let nx = r[0] + d1[0] * s - d2[0] * t, ny = r[1] + d1[1] * s - d2[1] * t, nz = r[2] + d1[2] * s - d2[2] * t;
      const squared = nx * nx + ny * ny + nz * nz;
      if (squared >= contact * contact) continue;
      const distance = Math.sqrt(squared), error = distance - contact;
      if (distance > 1e-12) { nx /= distance; ny /= distance; nz /= distance; } else {
        // Coincident axes: separate across both segments, or across the first one when parallel.
        nx = d1[1] * d2[2] - d1[2] * d2[1]; ny = d1[2] * d2[0] - d1[0] * d2[2]; nz = d1[0] * d2[1] - d1[1] * d2[0];
        if (Math.hypot(nx, ny, nz) < 1e-18) { nx = -d1[1]; ny = d1[0]; nz = 0; if (Math.hypot(nx, ny) < 1e-18) { nx = 0; ny = -d1[2]; nz = d1[1]; } }
        const size = Math.hypot(nx, ny, nz) || 1; nx /= size; ny /= size; nz /= size;
      }
      const wa0 = w[a[c]] * (1 - s), wa1 = w[b[c]] * s, wb0 = w[a[d]] * (1 - t), wb1 = w[b[d]] * t;
      const weight = wa0 * (1 - s) + wa1 * s + wb0 * (1 - t) + wb1 * t;
      if (weight <= 0) continue;
      const lambda = -error / weight;
      this.apply(p, a0, a1, b0, b1, wa0, wa1, wb0, wb1, nx * lambda, ny * lambda, nz * lambda);
      if (friction <= 0) continue;
      // Tangential motion of the contact point on c relative to the one on d during this substep.
      let tx = 0, ty = 0, tz = 0;
      for (let axis = 0; axis < 3; axis++) {
        const move = (1 - s) * (p[a0 + axis] - x[a0 + axis]) + s * (p[a1 + axis] - x[a1 + axis])
          - (1 - t) * (p[b0 + axis] - x[b0 + axis]) - t * (p[b1 + axis] - x[b1 + axis]);
        if (axis === 0) tx = move; else if (axis === 1) ty = move; else tz = move;
      }
      const along = tx * nx + ty * ny + tz * nz;
      tx -= along * nx; ty -= along * ny; tz -= along * nz;
      const slide = Math.sqrt(tx * tx + ty * ty + tz * tz), depth = -error;
      if (slide < 1e-15) continue;
      const share = slide < friction * depth ? 1 : Math.min(1, KINETIC * friction * depth / slide);
      const scale = -share / weight;
      this.apply(p, a0, a1, b0, b1, wa0, wa1, wb0, wb1, tx * scale, ty * scale, tz * scale);
    }
  }

  /** Moves c's ends by +delta and d's ends by -delta, weighted by inverse mass and barycentric share. */
  private apply(p: Float64Array, a0: number, a1: number, b0: number, b1: number, wa0: number, wa1: number, wb0: number, wb1: number,
    dx: number, dy: number, dz: number) {
    p[a0] += wa0 * dx; p[a0 + 1] += wa0 * dy; p[a0 + 2] += wa0 * dz;
    p[a1] += wa1 * dx; p[a1 + 1] += wa1 * dy; p[a1 + 2] += wa1 * dz;
    p[b0] -= wb0 * dx; p[b0 + 1] -= wb0 * dy; p[b0 + 2] -= wb0 * dz;
    p[b1] -= wb1 * dx; p[b1 + 1] -= wb1 * dy; p[b1 + 2] -= wb1 * dz;
  }
}
