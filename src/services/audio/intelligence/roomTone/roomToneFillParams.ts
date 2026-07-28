import type { RoomToneProfileManifest } from '../../roomToneProfileManifest';
import type { RoomToneProfileResult } from './roomToneProfiler';

const DEFAULT_MAX_RANGES = 5;

export function roomToneProfileToFillParams(
  result: RoomToneProfileResult | RoomToneProfileManifest,
  maxRanges = DEFAULT_MAX_RANGES,
): Record<string, string> {
  if (!Number.isInteger(maxRanges) || maxRanges < 0) {
    throw new Error('maxRanges must be a non-negative integer.');
  }
  const ranges = result.candidates
    .slice(0, maxRanges)
    .map(candidate => ({ start: candidate.start, end: candidate.end }));
  return { roomToneSourceRanges: JSON.stringify(ranges) };
}
