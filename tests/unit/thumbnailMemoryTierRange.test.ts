import { describe, expect, it, vi } from 'vitest';

vi.mock('../../src/services/timeline/thumbnailBitmapCache', () => ({ registerThumbnailBitmapSource: vi.fn(), closeByThumbnailUrls: vi.fn() }));
import { ThumbnailMemoryTier } from '../../src/services/thumbnailCache/memoryTier';

function tierWith(seconds: number[]) {
  const tier = new ThumbnailMemoryTier();
  const frames = tier.createSourceCache('cam');
  for (const second of seconds) frames.set(second, `url-${second}`);
  return { tier, frames };
}

describe('thumbnail memory tier ranges', () => {
  it('uses the exact second, a neighbour, or the nearest stored second (earlier on a tie)', () => {
    const { tier } = tierWith([0, 10, 20, 30]);
    expect(tier.getThumbnailsForRange('cam', 0, 40, 4)).toEqual(['url-0', 'url-10', 'url-20', 'url-30']);
    expect(tier.getThumbnailsForRange('cam', 11, 12, 1)).toEqual(['url-10']);
    expect(tier.getThumbnailsForRange('cam', 15, 16, 1)).toEqual(['url-10']);
    expect(tier.getThumbnailsForRange('cam', 16, 17, 1)).toEqual(['url-20']);
    expect(tier.getThumbnailsForRange('cam', 45, 46, 1)).toEqual(['url-30']);
    expect(tier.getThumbnailsForRange('cam', 99, 100, 1)).toEqual([null]);
    expect(tier.getThumbnailsForRange('cam', 0, 40, 2, true)).toEqual(['url-20', 'url-0']);
  });

  it('skips frames that are not drawable yet and sees frames added later', () => {
    const { tier, frames } = tierWith([0, 10, 20]);
    const drawable = (url: string) => url !== 'url-10';
    expect(tier.getThumbnailsForRange('cam', 10, 11, 1, false, drawable)).toEqual(['url-0']);
    frames.set(12, 'url-12');
    expect(tier.getThumbnailsForRange('cam', 13, 14, 1, false, drawable)).toEqual(['url-12']);
    expect(tier.getThumbnailsForRange('missing', 0, 10, 2)).toEqual([null, null]);
  });

  it('stays fast for a two-hour camera file and hundreds of clips', () => {
    const { tier } = tierWith(Array.from({ length: 10_000 }, (_, second) => second * 2));
    const started = performance.now();
    for (let clip = 0; clip < 600; clip += 1) tier.getThumbnailsForRange('cam', clip * 10 + 1, clip * 10 + 9, 12, false, () => true);
    expect(performance.now() - started).toBeLessThan(150);
  });
});

describe('thumbnail memory tier reach', () => {
  it('leaves a placeholder instead of a frame from far away and stays fast when most frames are still decoding', () => {
    const { tier } = tierWith(Array.from({ length: 10_000 }, (_, second) => second));
    const drawableOnlyAtStart = (url: string) => url === 'url-0';
    expect(tier.getThumbnailsForRange('cam', 5000, 5010, 2, false, drawableOnlyAtStart)).toEqual([null, null]);
    expect(tier.getThumbnailsForRange('cam', 20, 21, 1, false, drawableOnlyAtStart)).toEqual(['url-0']);
    const started = performance.now();
    for (let clip = 0; clip < 600; clip += 1) tier.getThumbnailsForRange('cam', clip * 15, clip * 15 + 8, 12, false, drawableOnlyAtStart);
    expect(performance.now() - started).toBeLessThan(150);
  });
});
