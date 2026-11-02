import { describe, expect, it } from 'vitest';
import { resolveDatamoshBakeDimensions, resolveDatamoshPlaybackBitrate } from '../../src/services/datamosh/datamoshTransitionBake';

describe('datamosh bake resolution', () => {
  it('bakes at the composition resolution', () => {
    expect(resolveDatamoshBakeDimensions(1920, 1080, 91)).toEqual({ width: 1920, height: 1080 });
    expect(resolveDatamoshBakeDimensions(1080, 1920, 241)).toEqual({ width: 1080, height: 1920 });
    expect(resolveDatamoshBakeDimensions(3840, 2160, 61)).toEqual({ width: 3840, height: 2160 });
  });

  it('scales down only what does not fit in memory, keeping the shape', () => {
    const reduced = resolveDatamoshBakeDimensions(3840, 2160, 481);
    expect(reduced.width).toBeLessThan(3840);
    expect(reduced.width).toBeGreaterThan(1280);
    expect(reduced.width / reduced.height).toBeCloseTo(16 / 9, 1);
    expect(reduced.width % 2).toBe(0);
    expect(reduced.height % 2).toBe(0);
  });

  it('gives the playback artifact a bitrate from its pixels, not from the Data Rate', () => {
    expect(resolveDatamoshPlaybackBitrate(1920, 1080, 30)).toBeGreaterThan(15_000_000);
    expect(resolveDatamoshPlaybackBitrate(3840, 2160, 30)).toBe(resolveDatamoshPlaybackBitrate(1920, 1080, 30) * 4);
  });
});
