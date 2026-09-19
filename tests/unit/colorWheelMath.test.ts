import { describe, expect, it } from 'vitest';

import {
  WHEEL_CONTROL_CONFIGS,
  getWheelPuckPosition,
  getWheelValuesFromPoint,
} from '../../src/components/panels/color/colorEditorMath';
import { WHEEL_COLOR_PARAM_DEFS } from '../../src/types/colorCorrection';

describe('color wheel channel mapping', () => {
  it.each(WHEEL_CONTROL_CONFIGS)('$label maps the visible cardinal colors to RGB', config => {
    const top = getWheelValuesFromPoint(config, WHEEL_COLOR_PARAM_DEFS, 0, 1);
    const right = getWheelValuesFromPoint(config, WHEEL_COLOR_PARAM_DEFS, 1, 0);
    const bottom = getWheelValuesFromPoint(config, WHEEL_COLOR_PARAM_DEFS, 0, -1);
    const left = getWheelValuesFromPoint(config, WHEEL_COLOR_PARAM_DEFS, -1, 0);

    expect(top.r).toBeGreaterThan(top.g);
    expect(top.b).toBeGreaterThan(top.g);
    expect(right.b).toBeGreaterThan(right.r);
    expect(right.b).toBeGreaterThan(right.g);
    expect(bottom.g).toBeGreaterThan(bottom.r);
    expect(bottom.g).toBeGreaterThan(bottom.b);
    expect(left.r).toBeGreaterThan(left.g);
    expect(left.r).toBeGreaterThan(left.b);
  });

  it.each(WHEEL_CONTROL_CONFIGS)('$label keeps wheel points stable through an RGB round trip', config => {
    const neutral = WHEEL_COLOR_PARAM_DEFS.find(def => def.key === config.rKey)?.defaultValue;
    expect(neutral).toBeDefined();

    for (const point of [
      { x: 0, y: 1 },
      { x: 1, y: 0 },
      { x: 0, y: -1 },
      { x: -1, y: 0 },
      { x: 0.35, y: 0.6 },
    ]) {
      const values = getWheelValuesFromPoint(config, WHEEL_COLOR_PARAM_DEFS, point.x, point.y);
      const roundTrip = getWheelPuckPosition(config, values, neutral!);
      expect(roundTrip.x).toBeCloseTo(point.x, 10);
      expect(roundTrip.y).toBeCloseTo(point.y, 10);
    }
  });
});
