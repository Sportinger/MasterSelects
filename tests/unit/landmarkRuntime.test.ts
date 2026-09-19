import { describe, expect, it } from 'vitest';
import { decorateLandmarkEffects } from '../../src/services/landmarkTracking/landmarkRuntime';
import type { Effect } from '../../src/types/effects';

describe('landmark effect decoration', () => {
  it('feeds existing optical-flow analysis into Kinetic Trace without requiring a landmark run', () => {
    const effect = {
      id: 'kinetic-test',
      type: 'kinetic-trace',
      name: 'Trace Motion',
      enabled: true,
      params: {},
    } satisfies Effect;

    const [decorated] = decorateLandmarkEffects(
      'clip-without-landmarks',
      1,
      [effect],
      { x: 0.125, y: -0.075 },
    );

    expect(decorated.params.trackingMotionX).toBe(0.125);
    expect(decorated.params.trackingMotionY).toBe(-0.075);
    expect(decorated.params.trackingCount).toBe(0);
  });
});
