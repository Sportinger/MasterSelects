export type MotionPixel = [number, number, number, number];
export type MotionSampler = (uv: [number, number]) => MotionPixel;
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
const luma = (pixel: MotionPixel) => pixel[0] * .299 + pixel[1] * .587 + pixel[2] * .114;

/** CPU reference for the bounded GPU LK estimator, including confidence and
 * signed interval convention. Kept independent of media/runtime ownership. */
export function evaluateOpticalFlow(reference: MotionSampler, target: MotionSampler, uv: [number, number], delta: number,
  resolution: [number, number]): MotionPixel {
  if (Math.abs(delta) < 1e-6) return [0, 0, 0, 0];
  const size = resolution.map(value => Math.max(1, value));
  const velocity = [0, 0]; let confidence = 0;
  for (let level = 2; level >= 0; level--) {
    const pixel = size.map(value => 2 ** level / value);
    for (let iteration = 0; iteration < 3; iteration++) {
      let xx = 0, yy = 0, xy = 0, xt = 0, yt = 0, weights = 0;
      for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
        const p: [number, number] = [uv[0] + x * pixel[0], uv[1] + y * pixel[1]];
        const q: [number, number] = [p[0] + velocity[0], p[1] + velocity[1]];
        if ([0, 1].some(i => p[i] < pixel[i] || p[i] > 1 - pixel[i] || q[i] < pixel[i] || q[i] > 1 - pixel[i])) continue;
        const weight = Math.exp(-.25 * (x * x + y * y));
        const dx = .5 * (luma(target([q[0] + pixel[0], q[1]])) - luma(target([q[0] - pixel[0], q[1]])));
        const dy = .5 * (luma(target([q[0], q[1] + pixel[1]])) - luma(target([q[0], q[1] - pixel[1]])));
        const dt = luma(reference(p)) - luma(target(q));
        xx += weight * dx * dx; yy += weight * dy * dy; xy += weight * dx * dy;
        xt += weight * dx * dt; yt += weight * dy * dt; weights += weight;
      }
      const determinant = xx * yy - xy * xy, trace = xx + yy;
      const eigen = .5 * (trace - Math.sqrt(Math.max(0, trace * trace - 4 * determinant))) / Math.max(weights, 1);
      if (determinant <= 1e-8 || weights < 4) { confidence = 0; continue; }
      const update = [(yy * xt - xy * yt) / determinant, (xx * yt - xy * xt) / determinant];
      for (let i = 0; i < 2; i++) velocity[i] = clamp(velocity[i] + clamp(update[i], -2, 2) * pixel[i], -32 / size[i], 32 / size[i]);
      confidence = clamp(eigen / (eigen + .0001), 0, 1);
    }
  }
  if ([0, 1].some(i => uv[i] + velocity[i] < 0 || uv[i] + velocity[i] > 1)) return [0, 0, 0, 0];
  let residual = 0, support = 0;
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
    const p: [number, number] = [uv[0] + x / size[0], uv[1] + y / size[1]];
    const q: [number, number] = [p[0] + velocity[0], p[1] + velocity[1]];
    if ([0, 1].some(i => p[i] < 0 || p[i] > 1 || q[i] < 0 || q[i] > 1)) continue;
    const w = Math.exp(-.25 * (x * x + y * y)), error = luma(reference(p)) - luma(target(q));
    residual += w * error * error; support += w;
  }
  confidence *= Math.exp(-residual / Math.max(support, .0001) / .01);
  return [velocity[0] / delta, velocity[1] / delta, confidence, confidence > .0001 ? 1 : 0];
}

/** Spatial consensus operates on signed velocity, before the nonlinear stretch
 * estimate. Inconsistent vectors reduce confidence instead of painting noise. */
export function evaluateMotionConsistency(sample: MotionSampler, uv: [number, number], radius: number,
  resolution: [number, number]): MotionPixel {
  if (radius <= 0) return sample(uv);
  const size = resolution.map(value => Math.max(1, value));
  const step = size.map(value => clamp(radius, 0, .1) * Math.max(...size) * .5 / value);
  let vx = 0, vy = 0, square = 0, weight = 0, area = 0;
  for (let y = -2; y <= 2; y++) for (let x = -2; x <= 2; x++) {
    const spatial = Math.exp(-.5 * (x * x + y * y));
    const motion = sample([clamp(uv[0] + x * step[0], .5 / size[0], 1 - .5 / size[0]),
      clamp(uv[1] + y * step[1], .5 / size[1], 1 - .5 / size[1])]);
    const w = spatial * clamp(motion[2], 0, 1) * clamp(motion[3], 0, 1);
    vx += motion[0] * w; vy += motion[1] * w;
    square += (motion[0] ** 2 + motion[1] ** 2) * w; weight += w; area += spatial;
  }
  if (weight < .000001) return [0, 0, 0, 0];
  vx /= weight; vy /= weight;
  const variance = Math.max(0, square / weight - vx * vx - vy * vy);
  const tolerance = .25 * (vx * vx + vy * vy) + .000001;
  const confidence = clamp(weight / area, 0, 1) * tolerance / (tolerance + variance);
  return [vx, vy, confidence, confidence > .0001 ? 1 : 0];
}

export function evaluateDirectionalSmooth(sample: MotionSampler, uv: [number, number], direction: number[], radius: number,
  mask: number, resolution: [number, number]): MotionPixel {
  const center = sample(uv), magnitude = Math.hypot(...direction);
  if (radius <= 0 || mask <= 0 || magnitude <= 1e-6) return center;
  const offset = direction.map((value, i) => value / magnitude * clamp(radius, 0, 16) / Math.max(resolution[i], 1));
  const sum = [...center]; let weights = 1;
  for (let i = 1; i <= 4; i++) {
    const t = i / 4, weight = Math.exp(-2 * t * t);
    for (const side of [-1, 1]) {
      const value = sample([clamp(uv[0] + offset[0] * t * side, .5 / resolution[0], 1 - .5 / resolution[0]),
        clamp(uv[1] + offset[1] * t * side, .5 / resolution[1], 1 - .5 / resolution[1])]);
      value.forEach((component, index) => { sum[index] += component * weight; }); weights += weight;
    }
  }
  return center.map((value, i) => value + (sum[i] / weights - value) * clamp(mask, 0, 1)) as MotionPixel;
}
