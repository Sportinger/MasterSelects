import type { FootstepDecision } from './footstepDecisions';

const fract = (value: number) => value - Math.floor(value);
const smooth = (a: number, b: number, value: number) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const spreads = [[.55, -.18], [1.25, -.45], [.8, -1], [1.65, -.7], [.3, -1.5], [1.05, -1.2]];

/** Place small cards near their own anchor, avoiding every already placed card. */
export function placeAnalysisCard(anchor: number[], placed: number[][], groundTop = anchor[1] - .05): number[] {
  const width = .37 * .52, height = .092 * .52;
  let best = [0, 0], bestScore = Infinity;
  const bottom = Math.max(.135 + height, Math.min(.85, groundTop - .035));
  for (const column of [anchor[0] - width / 2, .03, .03 + (.94 - width) / 3, .03 + 2 * (.94 - width) / 3, .97 - width]) {
    for (let row = 0; row < 6; row++) {
      const x = Math.max(.03, Math.min(.97 - width, column));
      const y = Math.max(.135, bottom - height - row * (height + .015));
      let score = Math.hypot(x + width / 2 - anchor[0], y + height / 2 - anchor[1]);
      for (const previous of placed) {
        const overlapX = Math.max(0, width + .012 - Math.abs(previous[0] - x));
        const overlapY = Math.max(0, height + .012 - Math.abs(previous[1] - y));
        score += overlapX * overlapY * 10000;
      }
      if (score < bestScore) { bestScore = score; best = [x, y]; }
    }
  }
  placed.push(best);
  return best;
}

/** Source-time schedule shared by the cards and sound authoring.
 * Keep the ground shader's rolling-search formulas in footstepDecision.wgsl aligned.
 */
export function footstepCandidates(d: FootstepDecision) {
  const { seed, age: elapsed, scanDuration: duration, locked } = d;
  const count = 2 + Math.floor(seed * 2);
  const candidates = [];
  for (let i = 0; i <= count; i++) {
    const winner = i === count;
    if (winner && (d.searchOnly || locked)) continue;
    let age = elapsed, spatialSeed = seed, attempt = 0;
    let launch = d.searchOnly ? 0 : winner ? duration * (.06 + fract(seed * 5.17) * .28)
      : .04 + seed * .08 + i * (.18 + seed * .10);
    const variation = fract(seed * 13.71 + i * .381966);
    const ending = d.searchOnly && (d.endingAge ?? 0) > 0;
    const redDuration = ending ? .50 : .32;
    const blueDuration = ending ? .20 + variation * .33 : d.searchOnly ? .55 + variation * .95 : winner ? duration - launch : .15 + variation * .22;
    if (!d.searchOnly && !winner) {
      if (launch >= duration) continue;
      const period = blueDuration + redDuration + .05;
      attempt = Math.floor(Math.max(0, Math.min(elapsed, duration) - launch) / period);
      launch += attempt * period;
      spatialSeed = fract(seed + attempt * .137);
    }
    if (d.searchOnly) {
      const period = blueDuration + redDuration + .08 + variation * (ending ? .10 : .25);
      const phase = ending ? d.endingAge! + i * .17 : elapsed + i * .71;
      const cycle = Math.floor(phase / period);
      // Finish an existing rejection, but progressively stop replacing lanes.
      if (ending && i > 0 && cycle * period - i * .17 > .35 + (count - 1 - i) * .32) continue;
      age = fract(phase / period) * period;
      spatialSeed = fract(seed + Math.floor(phase / period) * .137);
    }
    const rejectAt = winner ? Infinity : launch + blueDuration;
    const finish = rejectAt + redDuration;
    if (age < launch || age > finish || (!d.searchOnly && age >= duration + .20)) continue;
    const rejected = age >= rejectAt && (!locked || rejectAt < duration);
    const opacity = (winner ? 1 : 1 - smooth(rejectAt + (finish - rejectAt) * .7, finish, age))
      * smooth(launch, launch + Math.min(.08, blueDuration * .2), age)
      * (locked ? 1 - smooth(duration, duration + .20, age) : 1);
    const spread = spreads[(i + attempt) % 6];
    candidates.push({ index: winner ? 0 : i + 1, age: age - launch, spatialSeed, launch, blueDuration, rejectAt, rejected, opacity,
      shift: winner ? [0, 0] : [(i % 2 ? 1 : -1) * spread[0] * (.85 + spatialSeed * .3), spread[1] * (.85 + spatialSeed * .25)] });
  }
  return candidates;
}

/** Keep ending probes inside the observed mesh instead of projecting past its edge. */
export function endingCandidateShift(seed: number, index: number, placement: {x:number;y:number;width:number;height:number;rotation:number}, bounds: number[]): number[] {
  const angle = placement.rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
  const halfX = (Math.abs(c)*placement.width + Math.abs(s)*placement.height)*.58;
  const halfY = (Math.abs(s)*placement.width + Math.abs(c)*placement.height)*.58;
  const minX = bounds[0]+halfX, maxX = Math.max(minX,bounds[0]+bounds[2]-halfX);
  const minY = bounds[1]+halfY, maxY = Math.max(minY,Math.min(bounds[1]+bounds[3]-halfY,placement.y+placement.height*.2));
  const x = minX+(maxX-minX)*fract(seed*11.7+index*.618034)-placement.x;
  const y = minY+(maxY-minY)*fract(seed*5.3+index*.381966)-placement.y;
  return [(c*x+s*y)/placement.width,(-s*x+c*y)/placement.height];
}
