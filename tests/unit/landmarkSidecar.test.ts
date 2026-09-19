import { gunzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { exportLandmarkSidecar } from '../../src/services/landmarkTracking/landmarkSidecar';
import type { LandmarkSeries } from '../../src/services/landmarkTracking/types';

function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.readAsArrayBuffer(blob);
  });
}

describe('landmark sidecar', () => {
  it('exports a real gzip payload that round-trips the serializable time series', async () => {
    const series: LandmarkSeries = {
      version: 1,
      clipId: 'clip-sidecar',
      sourceId: 'media-source',
      sampleInterval: 0.125,
      createdAt: 123,
      frames: [{
        time: 0,
        hands: [[{ x: 0.25, y: 0.75, z: 0 }]],
        faces: [],
        poses: [],
      }],
    };

    const blob = await exportLandmarkSidecar(series);
    const restored = JSON.parse(strFromU8(gunzipSync(await blobBytes(blob))));

    expect(blob.type).toBe('application/gzip');
    expect(restored).toEqual(series);
  });
});
