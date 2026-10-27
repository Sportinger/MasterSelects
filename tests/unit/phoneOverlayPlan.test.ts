import { describe, expect, it } from 'vitest';

import { listPhoneOverlaysAtPlayhead, phoneOverlayTransform } from '../../src/components/mobileSkin/overlay/phoneOverlayPlan';
import { phoneFormatPresetFor, phoneAspectLabel, PHONE_FORMAT_PRESETS } from '../../src/components/mobileSkin/format/phoneFormatPresets';

const tracks = [
  { id: 'v3', type: 'video' as const, locked: false, name: 'Video 3' },
  { id: 'v2', type: 'video' as const, locked: false, name: 'Video 2' },
  { id: 'v1', type: 'video' as const, locked: false, name: 'Video 1' },
  { id: 'a1', type: 'audio' as const, locked: false, name: 'Audio 1' },
];

describe('phone overlays at the playhead', () => {
  it('lists clips above the main track under the playhead, top track first', () => {
    const clips = [
      { id: 'main', name: 'Main', trackId: 'v1', startTime: 0, duration: 10 },
      { id: 'pip', name: 'PiP', trackId: 'v2', startTime: 2, duration: 3 },
      { id: 'top', name: 'Top', trackId: 'v3', startTime: 1, duration: 2 },
      { id: 'later', name: 'Later', trackId: 'v2', startTime: 6, duration: 1 },
      { id: 'music', name: 'Music', trackId: 'a1', startTime: 0, duration: 10 },
    ];
    expect(listPhoneOverlaysAtPlayhead(tracks, clips, 2.5).map((entry) => entry.clipId)).toEqual(['top', 'pip']);
    expect(listPhoneOverlaysAtPlayhead(tracks, clips, 5)).toEqual([]);
    expect(listPhoneOverlaysAtPlayhead(tracks, clips, 6).map((entry) => entry.clipId)).toEqual(['later']);
  });
});

describe('phone picture in picture', () => {
  const comp = { width: 1080, height: 1920 };
  it('centres or puts the overlay in a corner with an even gap', () => {
    expect(phoneOverlayTransform('medium', 'center', { width: 360, height: 640 }, comp)).toEqual({ scale: 0.5, x: 0, y: 0 });
    const corner = phoneOverlayTransform('medium', 'top-right', { width: 360, height: 640 }, comp);
    expect(corner.scale).toBe(0.5);
    expect(corner.x).toBeCloseTo(0.44, 9);
    expect(corner.y).toBeCloseTo(-(1 - 0.06 * (1080 / 1920) - 0.5), 9);
    // Pixel gaps match on both axes.
    expect((1 - 0.5 - corner.x) * comp.width).toBeCloseTo((1 - 0.5 + corner.y) * comp.height, 6);
    const landscape = phoneOverlayTransform('small', 'bottom-left', { width: 1920, height: 1080 }, comp);
    expect(landscape.x).toBeLessThan(0);
    expect(landscape.y).toBeGreaterThan(0);
  });
});

describe('phone format presets', () => {
  it('has 1080 px on the short side and maps sizes back', () => {
    for (const preset of PHONE_FORMAT_PRESETS) expect(Math.min(preset.width, preset.height)).toBe(1080);
    expect(phoneFormatPresetFor(2520, 1080)).toBe('21:9');
    expect(phoneFormatPresetFor(1280, 720)).toBeNull();
    expect(phoneAspectLabel(1280, 720)).toBe('16:9');
  });
});
