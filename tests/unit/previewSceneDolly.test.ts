import { describe, expect, it } from 'vitest';

import {
  resolveSceneDollyAnimationStep,
  resolveSceneDollyImpulse,
} from '../../src/components/preview/previewSceneDolly';

describe('preview scene dolly', () => {
  it('uses a restrained proportional step for a standard mouse-wheel notch', () => {
    const towardTarget = resolveSceneDollyImpulse(5, 0, -100);
    const awayFromTarget = resolveSceneDollyImpulse(5, 0, 100);

    expect(towardTarget).toBeGreaterThan(0.3);
    expect(towardTarget).toBeLessThan(0.35);
    expect(awayFromTarget).toBeLessThan(-0.33);
    expect(awayFromTarget).toBeGreaterThan(-0.35);
  });

  it('accumulates rapid wheel input from the already pending target distance', () => {
    const firstImpulse = resolveSceneDollyImpulse(5, 0, -100);
    const secondImpulse = resolveSceneDollyImpulse(5, firstImpulse, -100);

    expect(firstImpulse + secondImpulse).toBeCloseTo(5 - 5 * Math.exp(-0.13), 10);
  });

  it('normalizes line-mode wheels and caps unusually large input spikes', () => {
    expect(resolveSceneDollyImpulse(5, 0, -3, 1)).toBeCloseTo(
      resolveSceneDollyImpulse(5, 0, -48, 0),
      10,
    );
    expect(resolveSceneDollyImpulse(5, 0, -10_000)).toBeCloseTo(
      resolveSceneDollyImpulse(5, 0, -240),
      10,
    );
  });

  it('eases over time consistently across different frame rates', () => {
    const remaining = 1;
    const stepAt16Ms = resolveSceneDollyAnimationStep(remaining, 16);
    const firstStepAt8Ms = resolveSceneDollyAnimationStep(remaining, 8);
    const afterFirst8Ms = remaining - firstStepAt8Ms;
    const secondStepAt8Ms = resolveSceneDollyAnimationStep(afterFirst8Ms, 8);

    expect(firstStepAt8Ms + secondStepAt8Ms).toBeCloseTo(stepAt16Ms, 10);
    expect(stepAt16Ms).toBeGreaterThan(0);
    expect(stepAt16Ms).toBeLessThan(remaining);
  });
});
