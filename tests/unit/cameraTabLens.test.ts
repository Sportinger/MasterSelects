import { describe, expect, it } from 'vitest';
import {
  fovToFullFrameFocalLengthMm,
  fullFrameFocalLengthMmToFov,
} from '../../src/utils/cameraLens';

describe('camera lens conversion', () => {
  it('converts vertical FOV to full-frame equivalent focal length', () => {
    expect(fovToFullFrameFocalLengthMm(60)).toBeCloseTo(20.78, 2);
    expect(fovToFullFrameFocalLengthMm(10)).toBeCloseTo(137.16, 2);
  });

  it('round trips focal length through clamped FOV', () => {
    const focalLength = fovToFullFrameFocalLengthMm(45);
    expect(fullFrameFocalLengthMmToFov(focalLength)).toBeCloseTo(45, 5);
    expect(fullFrameFocalLengthMmToFov(0)).toBe(140);
  });
});
