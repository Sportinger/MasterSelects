import { describe, expect, it } from 'vitest';
import { alignedTimeMapTime } from '../../src/effects/time/slit-scan/timeMapAlignment';
import { temporalClipSource } from '../../src/effects/time/temporalClipSource';
import { readDepthMapMetadata } from '../../src/services/depthEstimation/depthMapMetadata';
import type { DepthMapMetadata } from '../../src/types/depthMap';
import type { TimelineClip } from '../../src/types/timeline';

const depthMap: DepthMapMetadata = { version: 1, sourceMediaId: 'source', sourceFingerprint: 'hash',
  sourceStart: 5, sourceEnd: 15, fps: 30, nearIsWhite: true, model: 'depth', modelRevision: '1', edge: 280, rangeSmoothing: .75 };
const media = { id: 'source', fileHash: 'hash' };
function clock(speed: number, timeFactor = 1) {
  return temporalClipSource({ id: 'clip', duration: 10 / timeFactor, inPoint: 5, outPoint: 15, speed,
    source: { type: 'video', mediaFileId: 'source' }, effects: [{ id: 'effect', type: 'slit-scan', enabled: true,
      params: { timeFactor, bypassSlowdown: true, bypassDurationFactor: timeFactor } }] } as TimelineClip, 2, [])!;
}
describe('depth source alignment', () => {
  it('retains free timeline offset without requiring provenance', () => {
    expect(alignedTimeMapTime({ mapStart: 3 }, 2, {})).toEqual({ time: -1 });
  });
  it.each([[1, 1, 2], [-1, 1, 8], [2, 1, 4], [1, 4, 8], [-1, 4, 2]])(
    'uses the shared trimmed source clock at speed %s and factor %s', (speed, factor, expected) => {
      expect(alignedTimeMapTime({ mapAlignment: 'source', mapStart: 999 }, 999, { depthMap }, clock(speed, factor), media).time).toBe(expected);
    });
  it('rejects missing provenance, changed sources, stale fingerprints and uncovered ranges', () => {
    const params = { mapAlignment: 'source' }, source = clock(1);
    expect(() => alignedTimeMapTime(params, 0, {}, source, media)).toThrow('metadata');
    expect(() => alignedTimeMapTime(params, 0, { depthMap }, { ...source, mediaId: 'other' }, media)).toThrow('different source');
    expect(() => alignedTimeMapTime(params, 0, { depthMap }, source, { ...media, fileHash: 'new' })).toThrow('changed');
    expect(() => alignedTimeMapTime(params, 0, { depthMap: { ...depthMap, sourceEnd: 6 } }, source, media)).toThrow('outside the bake');
  });
  it('copies only durable validated provenance', () => {
    expect(readDepthMapMetadata({ ...depthMap, runtime: {} })).toEqual(depthMap);
    expect(readDepthMapMetadata({ ...depthMap, sourceEnd: Infinity })).toBeUndefined();
    expect(readDepthMapMetadata({ ...depthMap, fps: 60 })).toBeUndefined();
  });
});
