import { describe, expect, it } from 'vitest';
import {
  buildWorkerGpuFrameStackReadbackLayout,
  unpackWorkerGpuFrameStackReadback,
} from '../../src/services/render/workerGpuVideoFrameCompositor';

describe('MD7 Worker GPU exact frame-stack readback', () => {
  it('uses WebGPU 256-byte row alignment and removes padding deterministically', () => {
    const width = 3;
    const height = 2;
    const layout = buildWorkerGpuFrameStackReadbackLayout(width, height);
    expect(layout).toEqual({
      unalignedBytesPerRow: 12,
      bytesPerRow: 256,
      bufferSize: 512,
    });

    const padded = new Uint8Array(layout.bufferSize).fill(255);
    padded.set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], 0);
    padded.set([13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24], layout.bytesPerRow);

    expect([...unpackWorkerGpuFrameStackReadback(padded, width, height, layout)]).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
      13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
    ]);
  });
});
