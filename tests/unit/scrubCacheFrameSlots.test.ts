import { describe, expect, it } from 'vitest';
import { frameIndexForTime, getScrubbingKey, getScrubbingKeyTime, quantizeToFrame } from '../../src/engine/texture/scrubbingCache/cacheKeys';
import { isPausedHtmlTargetMediaTimeUsable } from '../../src/engine/render/layerCollector/htmlVideoPausedFrameGuard';

describe('scrub cache frame slots', () => {
  it('maps a media time to the frame shown at it (last slot starting at or before it)', () => {
    expect(frameIndexForTime(0.75)).toBe(22);
    expect(frameIndexForTime(0.7333333333)).toBe(22);
    expect(frameIndexForTime(0.7499)).toBe(22);
    expect(frameIndexForTime(0.7666666667)).toBe(23);
    expect(quantizeToFrame(0.75)).toBe('0.733');
    // Keys round-trip through their 3-decimal strings.
    for (let frame = 0; frame < 300; frame++) {
      expect(frameIndexForTime(getScrubbingKeyTime(getScrubbingKey('v', frame / 30)))).toBe(frame);
    }
  });

  it('accepts the slot holding the target while paused, never one a full slot earlier', () => {
    expect(isPausedHtmlTargetMediaTimeUsable(0.733, 0.75)).toBe(true);
    expect(isPausedHtmlTargetMediaTimeUsable(0.733, 0.7666)).toBe(true);
    expect(isPausedHtmlTargetMediaTimeUsable(0.7, 0.75)).toBe(false);
  });
});
