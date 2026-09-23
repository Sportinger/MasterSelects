import type { SourceTemporalRequest } from './SourceTemporalRuntime';

/** Plan for the complete temporal window, not its initially clipped prefix. This
 * avoids reallocating at progressively lower resolutions as playback advances.
 * The exact PTS count is still checked by the resident allocator afterwards. */
export function adaptiveTemporalPreview(request: SourceTemporalRequest, memoryMiB: number) {
  const width = request.media.width!, height = request.media.height!;
  const maxSpeed = Math.max(Math.abs(request.source.speed), ...request.source.speedKeyframes.map(key => Math.abs(key.value)));
  const sourceSeconds = Math.min(request.source.outPoint - request.source.inPoint, request.horizon * maxSpeed);
  const gridFrames = Math.max(1, request.samples - 1) * (request.nearest ? 1 : 2);
  const fps = request.media.fps;
  const frames = fps && fps > 0 && !request.source.sourceMap && !request.source.speedKeyframes.length
    ? Math.min(gridFrames, Math.ceil(Math.max(0, sourceSeconds) * fps) + 2) : gridFrames;
  // Leave room for the rest of the editor and a full-quality streaming result
  // while paused. This is a ceiling, not a claim about available adapter memory.
  const budgetMiB = Math.min(memoryMiB, 1536);
  const budget = budgetMiB * 1024 * 1024 * .85;
  const slots = frames + Math.max(12, Math.ceil(frames / 4)) + 2;
  let divisor = 1;
  // Interactive quality must reduce upload/bandwidth even when the complete
  // window fits in VRAM. A memory-only policy kept 1080p playback at full size.
  // This only changes spatial history resolution, never the temporal grid.
  while (Math.max(width, height) / divisor > 960) divisor *= 2;
  while (width * height * 4 * slots / divisor ** 2 > budget && Math.max(width, height) / divisor > 160) divisor *= 2;
  return { maxEdge: divisor > 1 ? Math.max(160, Math.floor(Math.max(width, height) / divisor)) : undefined,
    budgetMiB, reserveFrames: slots - 2 };
}
