import { describe, expect, it } from 'vitest';
import { ParallelDecodeManager } from '../../src/engine/ParallelDecodeManager';

describe('ParallelDecodeManager runtime snapshot', () => {
  it('summarizes decoder and decoded frame buffer state as plain budget data', () => {
    const manager = new ParallelDecodeManager();
    const access = manager as unknown as {
      isActive: boolean;
      frameTolerance: number;
      clipDecoders: Map<string, Record<string, unknown>>;
    };
    access.isActive = true;
    access.frameTolerance = 33_333;
    access.clipDecoders.set('clip-parallel', {
      clipId: 'clip-parallel',
      clipName: 'Parallel Clip',
      decoder: {
        state: 'configured',
        decodeQueueSize: 4,
      },
      samples: [{}, {}, {}],
      sampleIndex: 2,
      videoTrack: {
        video: {
          width: 640,
          height: 360,
        },
      },
      codecConfig: {
        codec: 'avc1.640028',
        hardwareAcceleration: 'prefer-software',
      },
      frameBuffer: new Map([
        [1_000_000, {}],
        [1_033_333, {}],
      ]),
      sortedTimestamps: [1_000_000, 1_033_333],
      oldestTimestamp: 1_000_000,
      newestTimestamp: 1_033_333,
      lastDecodedTimestamp: 1_033_333,
      clipInfo: {
        isNested: true,
        parentClipId: 'parent-comp',
      },
      isDecoding: true,
      pendingDecode: Promise.resolve(),
    });

    const snapshot = manager.getRuntimeSnapshot();

    expect(snapshot).toMatchObject({
      isActive: true,
      frameToleranceUs: 33_333,
      clipCount: 1,
      totalBufferedFrames: 2,
      estimatedBufferedFrameBytes: 640 * 360 * 4 * 2,
    });
    expect(snapshot.clips[0]).toMatchObject({
      clipId: 'clip-parallel',
      codec: 'avc1.640028',
      decoderState: 'configured',
      decodeQueueSize: 4,
      frameBufferSize: 2,
      estimatedBufferedFrameBytes: 640 * 360 * 4 * 2,
      oldestBufferedTimeSeconds: 1,
      newestBufferedTimeSeconds: 1.033333,
      lastDecodedTimeSeconds: 1.033333,
      isNested: true,
      parentClipId: 'parent-comp',
    });
  });
});
