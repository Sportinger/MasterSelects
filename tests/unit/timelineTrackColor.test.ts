import { describe, expect, it } from 'vitest';
import { getTimelineTrackColor } from '../../src/components/timeline/trackColor';
import { getLabelHex } from '../../src/components/panels/media/labelColors';

describe('timeline track colors', () => {
  it('uses subtle type-specific colors when no label color is selected', () => {
    expect(getTimelineTrackColor({ type: 'video', labelColor: 'none' })).toBe('#2b4541');
    expect(getTimelineTrackColor({ type: 'audio', labelColor: 'none' })).toBe('#2d3b4d');
  });

  it('keeps explicit label colors above the type defaults', () => {
    expect(getTimelineTrackColor({ type: 'video', labelColor: 'orange' })).toBe(getLabelHex('orange'));
    expect(getTimelineTrackColor({ type: 'audio', labelColor: 'lavender' })).toBe(getLabelHex('lavender'));
  });

  it('keeps the MIDI identity color and neutral untyped fallback', () => {
    expect(getTimelineTrackColor({ type: 'midi', labelColor: 'none' })).toBe('#3a4050');
    expect(getTimelineTrackColor({ labelColor: 'none' })).toBe('#303030');
  });
});
