import { INPUT_HISTORY_CAPACITY } from './InputHistoryClock';

export type TemporalDirection = 'past' | 'future' | 'symmetric';

export interface PreparedTemporalWindowInput {
  /** All times here are output seconds; conversion happens after clip-boundary holding. */
  localTime: number;
  duration: number;
  horizon: number;
  direction: TemporalDirection;
  samples: number;
  sourceTimeAt: (localTime: number) => number;
}

export interface PreparedTemporalSample {
  /** Position in the time map, independent of source playback direction. */
  position: number;
  outputTime: number;
  sourceTime: number;
}

/** Seek-independent window using the caller's authoritative clip timing resolver.
 * Keep duplicate held timestamps: their map positions still delimit interpolation.
 * The decoder cache deduplicates PTS, not this spatial-to-temporal mapping.
 */
export function preparedTemporalWindow(input: PreparedTemporalWindowInput): PreparedTemporalSample[] {
  const { localTime, duration, horizon, direction, samples, sourceTimeAt } = input;
  if (![localTime, duration, horizon].every(Number.isFinite) || duration < 0 || horizon < 0) {
    throw new Error('Prepared temporal window requires finite times and nonnegative duration/horizon.');
  }
  if (!Number.isInteger(samples) || samples < 2 || samples > INPUT_HISTORY_CAPACITY) {
    throw new Error(`Prepared temporal window requires 2–${INPUT_HISTORY_CAPACITY} samples.`);
  }
  if (!['past', 'future', 'symmetric'].includes(direction)) throw new Error('Unknown temporal direction.');
  return Array.from({ length: samples }, (_, index) => {
    const position = index / (samples - 1);
    const offset = direction === 'past' ? -position * horizon
      : direction === 'future' ? position * horizon : (position - 0.5) * horizon;
    const outputTime = Math.max(0, Math.min(duration, localTime + offset));
    const sourceTime = sourceTimeAt(outputTime);
    if (!Number.isFinite(sourceTime)) throw new Error('Clip timing returned an invalid source timestamp.');
    return { position, outputTime, sourceTime };
  });
}

/** Count both the CPU cache and GPU atlas, including unused cells of its 8×8 layout. */
export function preparedTemporalMemory(width: number, height: number, samples: number, budgetBytes: number) {
  if (![width, height, samples, budgetBytes].every(Number.isSafeInteger)
    || width < 1 || height < 1 || samples < 2 || samples > INPUT_HISTORY_CAPACITY || budgetBytes < 1) {
    throw new Error('Invalid prepared temporal memory settings.');
  }
  const frameBytes = width * height * 4;
  const atlasBytes = frameBytes * INPUT_HISTORY_CAPACITY;
  const cacheBytes = frameBytes * samples;
  const metadataBytes = (INPUT_HISTORY_CAPACITY + 1) * 16;
  const totalBytes = atlasBytes + cacheBytes + metadataBytes;
  if (totalBytes > budgetBytes) throw new Error('Prepared temporal window exceeds memory budget. Reduce resolution or samples.');
  return { frameBytes, atlasBytes, cacheBytes, metadataBytes, totalBytes };
}
