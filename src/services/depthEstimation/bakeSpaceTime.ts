import { openObjectFrames } from '../objectTracking/objectFrames';
import { readDepthMapMetadata } from './depthMapMetadata';
import { encodeSpaceTime } from '../../effects/time/slit-scan/spaceTimeData';
import type { MediaFile } from '../../stores/mediaStore/types';

/** Reuse the shared CPU-analysis adapter: two leases, bounded pixels, no decoder per point. */
export async function bakeSpaceTime(source: MediaFile, depth: MediaFile, from: number, to: number,
  signal: AbortSignal, progress: (message: string) => void): Promise<string> {
  const metadata = readDepthMapMetadata(depth.depthMap);
  if (!metadata || metadata.sourceMediaId !== source.id || metadata.sourceFingerprint !== source.fileHash) {
    throw new Error('Choose a baked depth video belonging to this source.');
  }
  if (![from, to].every(Number.isFinite) || to <= from || to - from > 8
    || from < metadata.sourceStart || to > metadata.sourceEnd + 1e-6) {
    throw new Error('Choose up to eight source seconds covered by the depth video.');
  }
  const colorReader = await openObjectFrames(source, signal);
  let depthReader: Awaited<ReturnType<typeof openObjectFrames>> | undefined;
  try {
    depthReader = await openObjectFrames(depth, signal);
    const count = Math.max(2, Math.ceil((to - from) * 5));
    const columns = 40, rows = Math.max(1, Math.min(40, Math.round(columns * (source.height ?? 1) / (source.width ?? 1))));
    const values: number[] = []; let previousTime = -Infinity;
    for (let i = 0; i < count; i++) {
      signal.throwIfAborted();
      const color = await colorReader.read(from + i * (to - from) / count);
      if (color.time === previousTime) continue;
      previousTime = color.time;
      if (color.time < metadata.sourceStart - 1e-6) throw new Error('Depth coverage starts after the decoded source frame.');
      const map = await depthReader.read(Math.max(0, color.time - metadata.sourceStart));
      for (let y = 0; y < rows; y++) for (let x = 0; x < columns; x++) {
        const u = (x + .5) / columns, v = (y + .5) / rows;
        const index = (Math.floor(v * color.pixels.height) * color.pixels.width + Math.floor(u * color.pixels.width)) * 4;
        const d = (Math.floor(v * map.pixels.height) * map.pixels.width + Math.floor(u * map.pixels.width)) * 4;
        if (color.pixels.data[index + 3] < 128 || map.pixels.data[d + 3] < 128) continue;
        const near = map.pixels.data[d] / 255;
        values.push(u - .5, .5 - v, (metadata.nearIsWhite ? near : 1 - near) - .5, color.time - (from + to) / 2,
          color.pixels.data[index] / 255, color.pixels.data[index + 1] / 255, color.pixels.data[index + 2] / 255, 1);
      }
      progress(`Collecting observed surfaces · ${i + 1}/${count}`);
    }
    signal.throwIfAborted();
    return encodeSpaceTime({ sourceId: source.id, fingerprint: source.fileHash ?? '', from, to }, new Float32Array(values));
  } finally { depthReader?.close(); colorReader.close(); }
}
