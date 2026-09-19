import { describe, expect, it } from 'vitest';
import { supportsNativeVideoAlpha } from '../../src/components/export/exportAlphaSupport';
import { forceOpaqueAlpha } from '../../src/components/export/runners/runnerUtils';

const baseSelection = {
  encoder: 'ffmpeg' as const,
  ffmpegCodec: 'prores' as const,
  proresProfile: 'hq' as const,
  dnxhrProfile: 'dnxhr_hq' as const,
  hapFormat: 'hap' as const,
};

describe('native export alpha support', () => {
  it('only enables native alpha for alpha-capable codec variants', () => {
    expect(supportsNativeVideoAlpha(baseSelection)).toBe(false);
    expect(supportsNativeVideoAlpha({ ...baseSelection, proresProfile: '4444' })).toBe(true);
    expect(supportsNativeVideoAlpha({ ...baseSelection, ffmpegCodec: 'utvideo' })).toBe(true);
    expect(supportsNativeVideoAlpha({ ...baseSelection, ffmpegCodec: 'ffv1' })).toBe(true);
    expect(supportsNativeVideoAlpha({ ...baseSelection, ffmpegCodec: 'dnxhd', dnxhrProfile: 'dnxhr_444' })).toBe(false);
    expect(supportsNativeVideoAlpha({ ...baseSelection, encoder: 'hap', hapFormat: 'hap_alpha' })).toBe(true);
    expect(supportsNativeVideoAlpha({ ...baseSelection, encoder: 'webcodecs', ffmpegCodec: 'utvideo' })).toBe(false);
  });

  it('flattens only alpha bytes when native alpha is disabled', () => {
    const pixels = new Uint8Array([10, 20, 30, 0, 40, 50, 60, 128]);

    expect(forceOpaqueAlpha(pixels)).toEqual(new Uint8Array([
      10, 20, 30, 255, 40, 50, 60, 255,
    ]));
  });
});
