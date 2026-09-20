export type Rgb = [number, number, number];
const fract = (value: number) => value - Math.floor(value);
const mix = (a: number, b: number, t: number) => a * (1 - t) + b * t;
const step = (edge: number, value: number) => value < edge ? 0 : 1;

/** CPU reference for the legacy common.wgsl RGB→HSV implementation, including its 1e-10 stabilization. */
export function imageRgbToHsv(c: Rgb): Rgb {
  const K = [0, -1 / 3, 2 / 3, -1];
  const chooseP = step(c[2], c[1]);
  const leftP = [c[2], c[1], K[3], K[2]], rightP = [c[1], c[2], K[0], K[1]];
  const p = leftP.map((value, index) => mix(value, rightP[index], chooseP));
  const chooseQ = step(p[0], c[0]);
  const leftQ = [p[0], p[1], p[3], c[0]], rightQ = [c[0], p[1], p[2], p[0]];
  const q = leftQ.map((value, index) => mix(value, rightQ[index], chooseQ));
  const d = q[0] - Math.min(q[3], q[1]), e = 1e-10;
  return [Math.abs(q[2] + (q[3] - q[1]) / (6 * d + e)), d / (q[0] + e), q[0]];
}

/** CPU reference for the legacy common.wgsl HSV→RGB implementation. */
export function imageHsvToRgb(c: Rgb): Rgb {
  return [1, 2 / 3, 1 / 3].map(offset => {
    const p = Math.abs(fract(c[0] + offset) * 6 - 3);
    return c[2] * mix(1, Math.max(0, Math.min(1, p - 1)), c[1]);
  }) as Rgb;
}

export const imageFract = fract;
