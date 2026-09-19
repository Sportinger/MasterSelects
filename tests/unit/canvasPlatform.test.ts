import { describe, expect, it } from 'vitest';
import {
  prefersSoftwareTimelineCanvas,
  resetCanvasPlatformPreferenceForTests,
} from '../../src/utils/canvasPlatform';

describe('canvas platform policy', () => {
  it('never opts into software canvas rendering', () => {
    resetCanvasPlatformPreferenceForTests();

    expect(prefersSoftwareTimelineCanvas()).toBe(false);
  });
});
