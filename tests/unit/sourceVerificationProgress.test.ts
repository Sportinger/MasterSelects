import { describe, expect, it, vi } from 'vitest';
import { getSourceVerificationStatus, sourceVerificationPercent, subscribeSourceVerificationStatus, trackSourceVerification } from '../../src/services/project/repository/artifacts/sourceVerificationStatus';
import { keepsVerifiedSource } from '../../src/services/project/repository/transaction/domainAdapters/mediaAdapter';
import { gopThumbnailSeekTime, gopThumbnailStrideSeconds } from '../../src/services/mediaRuntime/codec/gopThumbnails';
import type { MediaFile } from '../../src/stores/mediaStore/types';
import type { EntityDTO } from '../../src/services/project/repository/contracts';

describe('source verification progress', () => {
  it('counts read bytes over the whole run and clears when the queue drains', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeSourceVerificationStatus(listener);
    const camera = trackSourceVerification(300);
    const stem = trackSourceVerification(100);
    camera.progress(150);
    expect(getSourceVerificationStatus()).toEqual({ files: 2, bytesDone: 150, bytesTotal: 400 });
    camera.finish(true);
    stem.progress(50);
    const status = getSourceVerificationStatus()!;
    expect(status).toEqual({ files: 1, bytesDone: 350, bytesTotal: 400 });
    expect(sourceVerificationPercent(status)).toBe(87);
    stem.finish(false);
    expect(getSourceVerificationStatus()).toBeNull();
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});

describe('relink keeps a verified full hash for the same bytes', () => {
  const hash = 'a'.repeat(64);
  const media = (fields: Partial<MediaFile>) => ({ id: 'cam', name: 'Totale.MXF', ...fields }) as MediaFile;
  const identity = (byteLength: number) => ({ type: 'verified-source-identity', schemaVersion: 1, value: { identityStatus: 'verified', byteLength }, references: [], blobs: [] }) as unknown as EntityDTO;
  const file = new File([new Uint8Array(8)], 'Totale.MXF');

  it('keeps it when size and fast fingerprint match', () => {
    expect(keepsVerifiedSource(media({ fileHash: hash }), media({ file, fileHash: hash.toUpperCase() }), identity(8))).toBe(true);
  });
  it('drops it for other bytes, another size, a missing fingerprint or an unverified source', () => {
    expect(keepsVerifiedSource(media({ fileHash: hash }), media({ file, fileHash: 'b'.repeat(64) }), identity(8))).toBe(false);
    expect(keepsVerifiedSource(media({ fileHash: hash }), media({ file, fileHash: hash }), identity(9))).toBe(false);
    expect(keepsVerifiedSource(media({}), media({ file }), identity(8))).toBe(false);
    expect(keepsVerifiedSource(media({ fileHash: hash }), media({ file, fileHash: hash }), undefined)).toBe(false);
    expect(keepsVerifiedSource(media({ fileHash: hash }), media({ fileHash: hash }), identity(8))).toBe(false);
  });
});

describe('long-GOP thumbnails', () => {
  // 25 fps, a key frame every 50 frames (2 s), display order equals stored order.
  const source = { metadata: { fps: 25 }, keyframeStoredIndexFor: (display: number) => Math.floor(display / 50) * 50, storedToDisplayIndex: (stored: number) => stored };
  it('seek to the key frame of the GOP instead of decoding up to the exact second', () => {
    expect(gopThumbnailSeekTime(source, 3)).toBeCloseTo(50.5 / 25);
    expect(gopThumbnailSeekTime(source, 1.9)).toBeCloseTo(0.5 / 25);
    expect(gopThumbnailSeekTime(null, 3)).toBe(3);
  });
  it('cap decoded thumbnails at 600 per source', () => {
    expect(gopThumbnailStrideSeconds(300)).toBe(1);
    expect(gopThumbnailStrideSeconds(7200)).toBe(12);
  });
});
