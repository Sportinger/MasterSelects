import { describe, expect, it } from 'vitest';
import { getCaptureDurationFallback } from '../../src/services/capture/recording/commitRecording';

describe('capture recording duration import', () => {
  it('keeps a valid probed file duration instead of a shorter recorder clock', () => {
    expect(getCaptureDurationFallback(4.8, 4)).toBeUndefined();
    expect(getCaptureDurationFallback(Infinity, 4)).toBe(4);
  });
});
