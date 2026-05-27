import { describe, expect, it } from 'vitest';

import { calculateHostedImageCost, calculateHostedKlingCost } from '../../functions/lib/kieai';
import { getFlashBoardPriceEstimate } from '../../src/services/flashboard/FlashBoardPricing';

describe('hosted Kie.ai pricing', () => {
  it('charges hosted Kling 3.0 at the 6x MasterSelects cloud multiplier', () => {
    expect(calculateHostedKlingCost('std', 10, false)).toBe(840);
    expect(calculateHostedKlingCost('std', 10, true)).toBe(1200);
    expect(calculateHostedKlingCost('pro', 10, false)).toBe(1080);
    expect(calculateHostedKlingCost('pro', 10, true)).toBe(1620);
  });

  it('charges hosted Nano Banana 2 image generation at the 6x cloud multiplier', () => {
    expect(calculateHostedImageCost('nano-banana-2', '1K')).toBe(48);
    expect(calculateHostedImageCost('nano-banana-2', '2K')).toBe(72);
    expect(calculateHostedImageCost('nano-banana-2', '4K')).toBe(108);
  });

  it('keeps Cloud labels separate from BYO Kie.ai vendor credits', () => {
    expect(getFlashBoardPriceEstimate({
      duration: 10,
      outputType: 'video',
      providerId: 'kling-3.0',
      service: 'cloud',
    })?.compactLabel).toBe('840 cr');

    expect(getFlashBoardPriceEstimate({
      duration: 10,
      outputType: 'video',
      providerId: 'kling-3.0',
      service: 'kieai',
    })?.fullLabel).toBe('140 Kie credits');
  });
});
