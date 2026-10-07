import profile from './knitDrawProfile.json';

/** Residual of the approved four-yarn draw-through study, relative to each stitch's
 * end chord. Only guides replay this shape progression; the live rods advance forward.
 * Formation follows the inverse shape progression, with its own spatial timing.
 */
export function drawThroughProfile(row: number, u: number, release: number, out: Float64Array | number[]) {
  const time = Math.max(0, Math.min(1, release)) * (profile.frames.length - 1);
  const t0 = Math.floor(time), t1 = Math.min(profile.frames.length - 1, t0 + 1), ft = time - t0;
  const point = Math.max(0, Math.min(1, u)) * (profile.points - 1);
  const p0 = Math.floor(point), p1 = Math.min(profile.points - 1, p0 + 1), fp = point - p0;
  const strand = ((row % profile.spec.rows) + profile.spec.rows) % profile.spec.rows;
  const first = (strand * profile.points + p0) * 3, second = (strand * profile.points + p1) * 3;
  // The captured pull stops short of perfectly straight. Release its small residual
  // over the final part of the exit so no second patch is carried around the return.
  const end = Math.max(0, Math.min(1, (release - 0.78) / 0.22));
  const keep = 1 - end * end * end * (10 + end * (-15 + 6 * end));
  for (let axis = 0; axis < 3; axis++) {
    const a = profile.frames[t0][first + axis], b = profile.frames[t0][second + axis];
    const c = profile.frames[t1][first + axis], d = profile.frames[t1][second + axis];
    out[axis] = ((a + (b-a)*fp)*(1-ft) + (c + (d-c)*fp)*ft) * keep;
  }
}
export const DRAW_PROFILE_SIZE = {width:profile.spec.width,height:profile.spec.height,depth:profile.spec.depth,lean:profile.spec.lean};

/** The finite pull lengthens the stitch chord as the loop releases. Removing that
 * chord from the residual must not remove its draw distance from the guide layout.
 * All yarns share a mean pitch so neighbouring stitch heads stay aligned.
 */
export function drawThroughSpan(release: number): number {
  const time = Math.max(0, Math.min(1, release)) * (profile.spans.length - 1);
  const a = Math.floor(time), b = Math.min(profile.spans.length - 1, a + 1), blend = time - a;
  let span = 0;
  for (let row = 0; row < profile.spec.rows; row++) span += profile.spans[a][row]*(1-blend) + profile.spans[b][row]*blend;
  return span / profile.spec.rows / profile.spec.width;
}
