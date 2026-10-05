/** Authoring helpers for a finite, paired physical knit passage. The entry replays
 * the complete release trajectory backwards. Only its mature seam and free return
 * are constructed; this is not an independently simulated closed yarn system. */
export const KNIT_PASSAGE_SHAPE = {
  depth: .0697703617781501, height: .11841441831733948, lean: 1.4954713398339015,
  resolution: 64, rows: 4, spacing: .13804612246770803, stitches: 18,
  width: .20860499638571656,
};
export const KNIT_PASSAGE_DURATION = 33.8;
export const KNIT_PASSAGE_SOURCE_RATE = 15;
export const KNIT_PASSAGE_SOURCE_POINTS = 18 * 64 + 1 + 48;
type Point = [number, number, number];
export interface KnitPassageDiagnostics { maxHalfX: number; minReturnSpan: number; maxReturnSpan: number }
const TAU = Math.PI * 2;
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ease = (x: number) => { const t = clamp(x); return t*t*t*(10+t*(-15+6*t)); };
const distance = (a: Point, b: Point) => Math.hypot(a[0]-b[0], a[1]-b[1], a[2]-b[2]);
const lerp = (a: number, b: number, t: number) => a + (b-a)*t;

/** Original curve points are kept: no separate row or stitch reparameterization. */
export function interpolateKnitPassageSource(raw: Float32Array, frames: number, time: number): Float32Array {
  const size = KNIT_PASSAGE_SOURCE_POINTS * 4 * 3;
  const frame = clamp(time * KNIT_PASSAGE_SOURCE_RATE, 0, frames - 1);
  const a = Math.floor(frame), b = Math.min(a + 1, frames - 1), t = frame - a;
  const out = new Float32Array(size);
  for (let i = 0; i < size; i++) out[i] = lerp(raw[a*size+i], raw[b*size+i], t);
  return out;
}
function pointAt(frame: Float32Array, row: number, point: number): Point {
  const at = clamp(point, 0, KNIT_PASSAGE_SOURCE_POINTS - 1), a = Math.floor(at);
  const b = Math.min(a+1, KNIT_PASSAGE_SOURCE_POINTS-1), t = at-a, start = row*KNIT_PASSAGE_SOURCE_POINTS;
  return [0, 1, 2].map(axis => lerp(frame[(start+a)*3+axis], frame[(start+b)*3+axis], t)) as Point;
}
function restPoint(cell: number, row: number): Point {
  const s = KNIT_PASSAGE_SHAPE, t = TAU * cell;
  return [(cell-s.stitches/2)*s.width+s.lean*Math.sin(2*t)*s.width/TAU,
    (row-1.5)*s.spacing+s.height*Math.cos(t), s.depth*Math.cos(2*t)];
}
/** Keep the complete last curved cell of every yarn, then enough released rail to
 * meet a return arc. A shared endpoint parameter preserves the four-yarn grouping. */
function tailEnd(frame: Float32Array, cut: number): number {
  let activeEnd = Math.max(3, Math.ceil(cut));
  for (let cell = Math.max(2, Math.floor(cut)); cell < 18; cell++) {
    let straightness = Infinity;
    for (let row = 0; row < 4; row++) {
      straightness = Math.min(straightness,distance(pointAt(frame, row, 24+64*cell), pointAt(frame, row, 24+64*(cell+1))) / .9456216);
    }
    if (straightness < .92) activeEnd = Math.max(activeEnd,cell+1-ease((straightness-.8)/.12));
  }
  const start = 24 + 64*activeEnd;
  let end = start;
  for (let row = 0; row < 4; row++) {
    let arc = 0, previous = pointAt(frame, row, start), index = start;
    while (index < KNIT_PASSAGE_SOURCE_POINTS-1 && arc < .48) {
      const next = pointAt(frame, row, index+1);
      arc += distance(previous, next); previous = next; index++;
    }
    end = Math.max(end, index);
  }
  return end;
}
function half(frame: Float32Array, row: number, cut: number, end: number, direction: number, diagnostics?: KnitPassageDiagnostics): Point[] {
  const start = 24+64*cut, count = Math.max(8, Math.ceil((end-start)*2));
  const origin = restPoint(cut, 1.5), points: Point[] = [];
  for (let i = 0; i <= count; i++) {
    const sample = lerp(start, end, i/count), cell = (sample-24)/64;
    const p = pointAt(frame, row, sample), canonical = restPoint(cell, row);
    // Only the first mature half-cell meets a canonical seam. The long physical
    // endpoint chord and every subsequent draw-through point remain intact.
    const weight = ease((cell-cut)/.5);
    const x = (lerp(canonical[0],p[0],weight)-origin[0])*direction;
    if (diagnostics) diagnostics.maxHalfX = Math.max(diagnostics.maxHalfX,Math.abs(x));
    const y = lerp(canonical[1],p[1],weight)-origin[1];
    const z = lerp(canonical[2],p[2],weight)-origin[2];
    const radius = .85-z, angle = Math.PI-1.4*x;
    points.push([radius*Math.cos(angle), radius*Math.sin(angle), y]);
  }
  return points;
}
const hermite = (a: number, b: number, da: number, db: number, t: number) =>
  (2*t*t*t-3*t*t+1)*a+(t*t*t-2*t*t+t)*da+(-2*t*t*t+3*t*t)*b+(t*t*t-t*t)*db;
function unwrapNear(angle: number, reference: number): number {
  return angle + TAU*Math.round((reference-angle)/TAU);
}
function returnArc(out: Point[], incoming: Point[], row: number, diagnostics?: KnitPassageDiagnostics): Point[] {
  const a = out.at(-1)!, b = incoming.at(-1)!;
  const before = out.at(-2)!, after = incoming.at(-2)!;
  let angleA = Math.atan2(a[1],a[0]);
  while (angleA > Math.PI) angleA -= TAU;
  const angleB = unwrapNear(Math.atan2(b[1],b[0]), Math.PI*1.5)-TAU;
  const span = angleB-angleA;
  if (diagnostics) { diagnostics.minReturnSpan = Math.min(diagnostics.minReturnSpan,span); diagnostics.maxReturnSpan = Math.max(diagnostics.maxReturnSpan,span); }
  const baseZ = (row-1.5)*KNIT_PASSAGE_SHAPE.spacing, result: Point[] = [];
  const shoulder = .24;
  const shoulderLength = .85*Math.abs(span)*shoulder;
  const tangentA = a.map((value,axis) => (value-before[axis])*shoulderLength/Math.max(1e-9,distance(a,before))) as Point;
  const tangentB = b.map((value,axis) => (after[axis]-value)*shoulderLength/Math.max(1e-9,distance(after,b))) as Point;
  const circle = (t: number): Point => {
    const angle = angleA+span*t;
    return [.85*Math.cos(angle),.85*Math.sin(angle),baseZ];
  };
  const circleTangent = (t: number): Point => {
    const angle = angleA+span*t;
    return [-.85*Math.sin(angle)*span*shoulder,.85*Math.cos(angle)*span*shoulder,0];
  };
  const startCircle = circle(shoulder), endCircle = circle(1-shoulder);
  const startTangent = circleTangent(shoulder), endTangent = circleTangent(1-shoulder);
  for (let i = 1; i < 256; i++) {
    const t = i/256;
    let point = circle(t);
    if (t < shoulder) {
      const u = t/shoulder;
      point = a.map((value,axis) => hermite(value,startCircle[axis],tangentA[axis],startTangent[axis],u)) as Point;
    } else if (t > 1-shoulder) {
      const u = (t-1+shoulder)/shoulder;
      point = b.map((value,axis) => hermite(endCircle[axis],value,endTangent[axis],tangentB[axis],u)) as Point;
    }
    result.push(point);
  }
  return result;
}
function resampleClosed(points: Point[], count: number): Float32Array {
  points.push(points[0]);
  const arc = new Float64Array(points.length);
  for (let i = 1; i < points.length; i++) arc[i] = arc[i-1]+distance(points[i-1],points[i]);
  const out = new Float32Array(count*3);
  for (let i = 0, cursor = 0; i < count-1; i++) {
    const at = arc.at(-1)! * i/(count-1);
    while (cursor < points.length-2 && arc[cursor+1] < at) cursor++;
    const span = arc[cursor+1]-arc[cursor], t = span > 0 ? (at-arc[cursor])/span : 0;
    for (let axis = 0; axis < 3; axis++) out[i*3+axis] = lerp(points[cursor][axis],points[cursor+1][axis],t);
  }
  out.set(out.subarray(0,3),(count-1)*3);
  return out;
}

/** Four upright closed display curves. The physical finite trajectories are sampled
 * together; there is no second solve or time reset that can accumulate a knot. */
export function sampleKnitPassage(outgoing: Float32Array, incoming: Float32Array, progress: number, points = 641, diagnostics?: KnitPassageDiagnostics): Float32Array {
  // Retain one additional mature stitch on each side of the seam. This separates
  // forming from release with two more complete stitches from the original solve.
  const p = clamp(progress), cutOut = 15.5-15*p, cutIn = .5+15*p;
  // Their sum is16: opposite stockinette phases join with matching first derivatives.
  const endOut = tailEnd(outgoing,cutOut), endIn = tailEnd(incoming,cutIn);
  const output = new Float32Array(4*points*3);
  for (let row = 0; row < 4; row++) {
    const out = half(outgoing,row,cutOut,endOut,1,diagnostics), entry = half(incoming,row,cutIn,endIn,-1,diagnostics);
    const joined = [...out,...returnArc(out,entry,row,diagnostics),...entry.toReversed()];
    output.set(resampleClosed(joined,points),row*points*3);
  }
  return output;
}
