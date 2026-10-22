/**
 * Frame budgets for CPU pixel paths that hold on any test machine.
 *
 * A fixed wall-clock budget fails on slower or loaded runners: the shared GitHub runners measured 3-4x the
 * times of a developer machine for the same frame. These helpers measure the work under test against a
 * reference loop on the same machine, in the same process, so a budget is "N times a plain scalar pass over
 * the same pixels". That keeps a budget meaningful (a per-pixel allocation or interpreter regression costs
 * 10-100x) while machine speed cancels out.
 */

/** Smallest wall time of `rounds` runs of `work` in ms (the first run also warms the JIT). */
export function fastestMs(work: () => void, rounds = 3): number {
  let best = Infinity;
  for (let round = 0; round < rounds; round += 1) {
    const started = performance.now();
    work();
    best = Math.min(best, performance.now() - started);
  }
  return best;
}

const smoothstep = (low: number, high: number, value: number) => {
  const t = Math.min(1, Math.max(0, (value - low) / (high - low)));
  return t * t * (3 - 2 * t);
};

/** The reference kernel: a scalar key of one pixel into `out`, the shape of work a keyer does per pixel. */
function referencePixel(r: number, g: number, b: number, out: Float64Array): void {
  const other = Math.max(r, b), purity = (g - other) / Math.max(g, 1e-4);
  const alpha = 1 - smoothstep(.1, .6, purity) * smoothstep(.05, .3, g);
  const excess = Math.max(g - (r + b) / 2, 0);
  out[0] = r; out[1] = g - excess; out[2] = b; out[3] = alpha;
}

/**
 * Fastest time in ms of the reference kernel over an RGBA8 frame (`data`), reading bytes and writing
 * through an output array like the CPU paths under test. Only the timing matters; the sum keeps the loop alive.
 */
export function referenceFrameMs(data: Uint8ClampedArray, rounds = 5): number {
  const out = new Float64Array(4);
  let sink = 0;
  const time = fastestMs(() => {
    for (let offset = 0; offset < data.length; offset += 4) {
      referencePixel(data[offset] / 255, data[offset + 1] / 255, data[offset + 2] / 255, out);
      sink += out[3];
    }
  }, rounds);
  if (!Number.isFinite(sink)) throw new Error('reference loop produced a non-finite sum');
  return time;
}
