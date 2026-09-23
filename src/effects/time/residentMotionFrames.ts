import { surfaceFrameIndex } from '../../services/planarTracking/surfaceFrameReader';
import type { SourceTemporalRequest } from './SourceTemporalRuntime';
import { temporalSourceTime } from './temporalClipSource';

/** Device-local snapshot. Pairs always name actual adjacent source PTS, never
 * two arbitrary positions in the scan's sampling grid. */
export interface ResidentMotionFrames {
  atlas: GPUTexture;
  width: number; height: number; columns: number; rows: number; layers: number;
  slots: ReadonlyMap<number, number>;
  pairs: ReadonlyMap<number, number>;
  metadata: Float32Array;
  identity: string;
  /** Runtime provenance for the durable source-pair cache; never a blob URL. */
  cacheSource?: { mediaId: string; file?: File; fileHash?: string; stabilization?: string };
}

export function adjacentMotionPairs(times: readonly number[], frames: readonly { time: number }[],
  source: SourceTemporalRequest['source'], contiguous = false) {
  const pairs = new Map<number, number>();
  let requested = times;
  if (contiguous && times.length && frames.length) {
    const indices = times.map(time => Math.max(0, surfaceFrameIndex(frames, time)));
    const first = Math.min(...indices), last = Math.min(frames.length - 1, Math.max(...indices) + 1);
    if (last - first > 8192) throw new Error('Motion geometry source window exceeds 8192 frames. Reduce Delay or Time factor.');
    requested = frames.slice(first, last + 1).map(frame => frame.time)
      .filter(time => time >= source.inPoint && time < source.outPoint);
  }
  for (const time of requested) {
    const index = Math.max(0, surfaceFrameIndex(frames, time));
    const previous = frames[index - 1]?.time, next = frames[index + 1]?.time;
    const target = previous !== undefined && previous >= source.inPoint ? previous
      : next !== undefined && next < source.outPoint ? next : time;
    pairs.set(time, target);
  }
  return pairs;
}

/** RG flow is stored per source second. Metadata converts it to the connected
 * graph delay clock, including reverse/variable speed and held clip boundaries. */
export function disMotionMetadata(metadata: Float32Array, request: SourceTemporalRequest) {
  const data = metadata.slice(), width = data.length / 8;
  const factor = request.timeFactor ?? 1;
  const count = Math.round(data[(width - 1) * 4]);
  for (let i = 0; i < count; i++) {
    const local = request.source.localTime - data[i * 4] * factor;
    const epsilon = .0001;
    const rate = (temporalSourceTime(request.source, local + epsilon)
      - temporalSourceTime(request.source, local - epsilon)) / (2 * epsilon) * factor;
    data[(width + i) * 4] = rate;
  }
  data[(width - 1) * 4 + 2] = 5;
  return data;
}
