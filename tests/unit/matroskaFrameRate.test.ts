import { describe, expect, it } from 'vitest';
import { isMatroskaFileName, readMatroskaFrameRate, snapFrameRate } from '../../src/services/mediaMetadata/matroskaFrameRate';

describe('Matroska frame rate', () => {
  it('reads only WebM and MKV names', () => {
    expect(isMatroskaFileName('clip.WEBM')).toBe(true);
    expect(isMatroskaFileName('clip.mkv')).toBe(true);
    expect(isMatroskaFileName('clip.mp4')).toBe(false);
  });

  it('snaps the millisecond-rounded average to the standard rate it comes from', () => {
    expect(snapFrameRate(30.03)).toBe(30);
    expect(snapFrameRate(29.97)).toBeCloseTo(30000 / 1001, 6);
    expect(snapFrameRate(59.9)).toBeCloseTo(60000 / 1001, 6);
    expect(snapFrameRate(23.98)).toBeCloseTo(24000 / 1001, 6);
  });

  it('keeps an unusual rate and refuses a useless one', () => {
    expect(snapFrameRate(12.5)).toBe(12.5);
    expect(snapFrameRate(0)).toBeUndefined();
    expect(snapFrameRate(Number.NaN)).toBeUndefined();
  });

  it('does not open other containers', async () => {
    await expect(readMatroskaFrameRate(new File(['x'], 'clip.mp4'))).resolves.toBeUndefined();
  });

  it('answers undefined for a file it cannot read', async () => {
    await expect(readMatroskaFrameRate(new File([new Uint8Array(64)], 'broken.webm'))).resolves.toBeUndefined();
  });
});
