import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('../../src/services/logger', () => ({ Logger: { create: () => ({ warn: mocks.warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() }) } }));

import { applyWorkerSoftwareSourceResamplingEffects } from '../../src/services/render/workerSoftwareSourceResamplingEffects';
import { fastestMs, referenceFrameMs } from '../helpers/cpuFrameBudget';

describe('software preview directional blur tap cap', () => {
  it('says once per effect and size when a streak is longer than its 64 taps', () => {
    const width = 192, height = 108, source = new Uint8ClampedArray(width * height * 4).fill(255);
    const short = { amount: 0.05, angle: 0 }, long = { amount: 0.3, angle: 0 };
    // 0.05 of 192 px reaches 9.6 px to each side: 64 taps cover it.
    applyWorkerSoftwareSourceResamplingEffects(source, width, height, 10, 10, { motionBlurAdjustments: [short] });
    expect(mocks.warn).not.toHaveBeenCalled();
    // 0.3 reaches 57.6 px to each side, a 115 px streak: the taps are about 1.8 px apart.
    for (let x = 0; x < 4; x += 1) applyWorkerSoftwareSourceResamplingEffects(source, width, height, x, 10, { motionBlurAdjustments: [long] });
    expect(mocks.warn).toHaveBeenCalledTimes(1);
    expect(mocks.warn.mock.calls[0][0]).toMatch(/motion-blur in the software preview at 192×108: the 115 px streak .*64 taps about 1\.8 px apart/);
  });

  // Fine stripes about 3 px wide: a sub-pixel change of the streak shows directly.
  const stripes = (width: number, height: number) => {
    const data = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = 127.5 + 127.5 * Math.sin(x * 2.1 + y * 0.07); data[index + 1] = 127.5 + 127.5 * Math.sin(y * 1.9 + x * 0.03);
      data[index + 2] = 127.5 + 127.5 * Math.sin((x + y) * 1.3); data[index + 3] = 255;
    }
    return data;
  };

  it.each([
    // Motion: the whole streak is 2 * amount * 192 px, so this ramp crosses 1, 2 and 3 px of streak.
    ['motionBlurAdjustments', { angle: 0.3 }, (index: number) => 0.0015 + index * 0.00012],
    // Spin at 60 px from the centre: the arc is amount * pi / 9 * 60 px, crossing 1, 2 and 3 px.
    ['radialBlurAdjustments', { mode: 'spin' as const }, (index: number) => 0.03 + index * 0.0028],
    // Zoom at about 60 px from the centre: the streak is ln(1 + amount / 2) * 60 px.
    ['zoomBlurAdjustments', {}, (index: number) => 0.02 + index * 0.0019],
  ] as const)('%s change smoothly when the amount is animated across 1, 2 and 3 px of streak (evenly spread taps jumped at each count step)', (key, extra, amountAt) => {
    const width = 192, height = 108, source = stripes(width, height);
    const pixels: Array<[number, number]> = [[156, 54], [96, 114 - 60], [140, 18], [44, 90]].map(([x, y]) => [Math.min(x, width - 1), Math.min(y, height - 1)]);
    const frames = Array.from({ length: 61 }, (_, index) => {
      const adjustment = { ...extra, amount: amountAt(index) };
      return pixels.flatMap(([x, y]) => [...applyWorkerSoftwareSourceResamplingEffects(source, width, height, x, y, { [key]: [adjustment] })!].slice(0, 3));
    });
    const changes = frames.slice(1).map((frame, index) => Math.max(...frame.map((value, channel) => Math.abs(value - frames[index][channel]))));
    const bends = frames.slice(2).map((frame, index) => Math.max(...frame.map((value, channel) => Math.abs(value - 2 * frames[index + 1][channel] + frames[index][channel]))));
    const median = changes.toSorted((a, b) => a - b)[Math.floor(changes.length / 2)];
    expect(median).toBeGreaterThan(1e-4);
    expect(Math.max(...bends) / median).toBeLessThan(1.5);
  });

  it.each([
    // About 24 taps a pixel at 240x135 (Motion 0.05 at 0.2 rad, Zoom 0.5 and Spin 0.5 at the far corners).
    ['motionBlurAdjustments', { amount: 0.05, angle: 0.2 }],
    ['zoomBlurAdjustments', { amount: 0.5 }],
    ['radialBlurAdjustments', { amount: 0.5, mode: 'spin' as const }],
  ] as const)('%s paints a frame within its budget: no arrays per pixel or per tap', (key, adjustment) => {
    const width = 240, height = 135, source = stripes(width, height);
    const blurred = fastestMs(() => {
      for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
        applyWorkerSoftwareSourceResamplingEffects(source, width, height, x, y, { [key]: [adjustment] });
      }
    });
    // Measured against a scalar reference pass over the same frame on this machine (cpuFrameBudget.ts), so a
    // slow CI runner does not fail it. The scalar taps take about 40-70x that pass; building the taps, corners
    // and coordinate tuples as arrays for every read (the first covered-cell version, commit 959684610) took about 250-400x.
    expect(blurred).toBeLessThan(150 * referenceFrameMs(source));
  });
});
