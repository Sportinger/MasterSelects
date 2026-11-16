/**
 * Timeline thumbnails of long-GOP sources (MXF, HEVC). An exact seek to an inter frame decodes the
 * whole GOP up to it, so one thumbnail per second of a long software-decoded 4K source kept a core
 * busy for minutes. Thumbnails therefore land on key frames, and their count per source is capped.
 */
export const MAX_DECODED_GOP_THUMBNAILS = 600;

interface ThumbnailIndexSource {
  readonly metadata: { readonly fps?: number };
  keyframeStoredIndexFor(displayIndex: number): number;
  storedToDisplayIndex(storedIndex: number): number;
}

/** Display time of the key frame that starts the GOP holding `timeSeconds`. */
export function gopThumbnailSeekTime(source: ThumbnailIndexSource | null, timeSeconds: number): number {
  if (!source) return timeSeconds;
  const fps = source.metadata.fps || 25;
  const display = Math.max(0, Math.floor(timeSeconds * fps + 1e-6));
  const keyDisplay = source.storedToDisplayIndex(source.keyframeStoredIndexFor(display));
  if (keyDisplay < 0) return timeSeconds;
  // Middle of the key frame's display interval keeps the half-open packet test stable.
  return (keyDisplay + 0.5) / fps;
}

/** Seconds between decoded thumbnails; the seconds in between reuse the previous one. */
export function gopThumbnailStrideSeconds(durationSeconds: number): number {
  return Math.max(1, Math.ceil(durationSeconds / MAX_DECODED_GOP_THUMBNAILS));
}
