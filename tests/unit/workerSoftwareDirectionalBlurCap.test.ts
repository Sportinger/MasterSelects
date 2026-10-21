import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock('../../src/services/logger', () => ({ Logger: { create: () => ({ warn: mocks.warn, info: vi.fn(), debug: vi.fn(), error: vi.fn() }) } }));

import { applyWorkerSoftwareSourceResamplingEffects } from '../../src/services/render/workerSoftwareSourceResamplingEffects';

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
});
