import { describe, expect, it } from 'vitest';
import { curveLabelGlitchEvent } from '../../src/engine/native3d/labels/curveLabelGlitch';

describe('window glitch schedule', () => {
  it('starts at 12 seconds and repeats at 24, 36 and 48 within the 59-second composition', () => {
    expect(curveLabelGlitchEvent(0).age).toBe(-1);
    expect(curveLabelGlitchEvent(11.999).age).toBe(-1);
    for (const time of [12,24,36,48]) {
      expect(curveLabelGlitchEvent(time)).toEqual({ age:0,event:time/12-1 });
      expect(curveLabelGlitchEvent(time+.75).age).toBe(.75);
    }
    expect(curveLabelGlitchEvent(59)).toEqual({ age:11,event:3 });
  });
  it('is identical across reverse scrubs, repeated frames and preview/export sample rates', () => {
    const times = [36.5,12.5,48.5,24.5,12.5,36.5];
    expect(times.map(curveLabelGlitchEvent)).toEqual([
      { age:.5,event:2 },{ age:.5,event:0 },{ age:.5,event:3 },
      { age:.5,event:1 },{ age:.5,event:0 },{ age:.5,event:2 },
    ]);
    expect(curveLabelGlitchEvent(385/30)).toEqual(curveLabelGlitchEvent(770/60));
    expect(curveLabelGlitchEvent(NaN).age).toBe(-1);
    expect(curveLabelGlitchEvent(-10).age).toBe(-1);
  });
});
