import { Logger } from '../logger';

// The browser reports no frame rate and the MP4 probe does not read WebM/MKV, so such a source had no
// known rate. Frame-exact seeks then absorb only microsecond rounding, while WebM stores whole
// milliseconds (frame 2 of 30 fps at 67 ms, its exact time 66.67 ms): PRECISE export repeated every
// third frame, and a paused preview showed the frame before.
const log = Logger.create('MatroskaFrameRate');
const MATROSKA_EXTENSIONS = new Set(['webm', 'mkv']);
const PROBE_TIMEOUT_MS = 5000;
const PACKETS_TO_SAMPLE = 200;
/** Millisecond timestamps make the average slightly off; a rate this close to a standard one is that one. */
const STANDARD_RATE_TOLERANCE = 0.003;
const STANDARD_RATES = [24000 / 1001, 24, 25, 30000 / 1001, 30, 48, 50, 60000 / 1001, 60, 100, 120];

export function isMatroskaFileName(fileName: string): boolean {
  return MATROSKA_EXTENSIONS.has(fileName.split('.').pop()?.toLowerCase() ?? '');
}

export function snapFrameRate(rate: number): number | undefined {
  if (!Number.isFinite(rate) || rate <= 0) return undefined;
  const standard = STANDARD_RATES.reduce((best, candidate) =>
    Math.abs(candidate - rate) < Math.abs(best - rate) ? candidate : best);
  return Math.abs(standard - rate) / standard <= STANDARD_RATE_TOLERANCE ? standard : Math.round(rate * 100) / 100;
}

async function probeFrameRate(file: File): Promise<number | undefined> {
  const mb = await import('mediabunny');
  const input = new mb.Input({ formats: [mb.WEBM, mb.MATROSKA], source: new mb.BlobSource(file) });
  try {
    const track = await input.getPrimaryVideoTrack();
    const stats = track ? await track.computePacketStats(PACKETS_TO_SAMPLE) : null;
    return stats ? snapFrameRate(stats.averagePacketRate) : undefined;
  } finally {
    input.dispose();
  }
}

/** Undefined for other containers and when the file cannot be read in time. */
export async function readMatroskaFrameRate(file: File): Promise<number | undefined> {
  if (!isMatroskaFileName(file.name)) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      probeFrameRate(file),
      new Promise<undefined>((resolve) => { timer = setTimeout(() => resolve(undefined), PROBE_TIMEOUT_MS); }),
    ]);
  } catch (error) {
    log.debug('Could not read the frame rate', { file: file.name, error });
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}
