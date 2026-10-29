// exportSurfaceBudget - how many decoded frames FAST export may hold open for one decoder.
// Hardware decoders (Android's MediaCodec behind Chrome's VideoDecoder) own a small pool of output
// surfaces, and every VideoFrame the page still holds keeps one of them. When the export holds the
// whole pool, the decoder keeps its queued samples and emits nothing, so every wait for the next
// frame ran into its time limit: 2-9 s per exported frame on a Pixel 10 Pro. The budget is learnt
// from the first such stall and from then on caps the frames kept behind and decoded ahead.

/**
 * No output for this long while samples are pending, with frames held open, counts as a stall.
 * Only after the decoder's first output since its configure: a hardware decoder starting up after a
 * keyframe restart is slow, not out of surfaces.
 */
export const SURFACE_STALL_MS = 100;
/** A learnt budget never goes below this; a smaller pool still works through the stall release. */
const MIN_BUDGET = 2;

export class ExportSurfaceBudget {
  private budget: number | null = null;
  // Frames held when a stall released some; an output right after confirms the budget.
  private probe: { held: number; atMs: number } | null = null;

  /** Surfaces the decoder hands out to this export, or null while no stall was seen. */
  get value(): number | null {
    return this.budget;
  }

  reset(): void {
    this.budget = null;
    this.probe = null;
  }

  /** A stall released frames while `held` were open; an output soon after confirms the pool size. */
  probeAfterRelease(held: number): void {
    this.probe = { held, atMs: performance.now() };
  }

  /** A decoder output arrived: the confirmed pool size when it ends a probe, else null. */
  confirmOnOutput(): number | null {
    const probe = this.probe;
    this.probe = null;
    return probe && performance.now() - probe.atMs <= 4 * SURFACE_STALL_MS ? probe.held : null;
  }

  /** The decoder stalled while the export held `held` frames. Returns true when the budget shrank. */
  learn(held: number): boolean {
    const next = Math.max(MIN_BUDGET, Math.floor(held));
    if (!Number.isFinite(next) || (this.budget !== null && this.budget <= next)) return false;
    this.budget = next;
    return true;
  }

  /**
   * Frames kept behind the shown one. They keep a one-frame step back cheap, but a small pool needs
   * its surfaces for the frames ahead: the shown frame plus at least one decoded ahead must fit.
   */
  keepBehind(defaultBehind: number): number {
    if (this.budget === null) return defaultBehind;
    return Math.max(0, Math.min(defaultBehind, this.budget - 2));
  }

  /** Frames the export may hold decoded ahead of the shown one. */
  aheadLimit(defaultAhead: number, defaultBehind: number): number {
    if (this.budget === null) return defaultAhead;
    return Math.max(0, Math.min(defaultAhead, this.budget - 1 - this.keepBehind(defaultBehind)));
  }

  /** Frames the background decode-ahead fills, the shown one included. */
  warmWindow(defaultAhead: number, defaultBehind: number): number {
    return this.budget === null ? defaultAhead : 1 + this.aheadLimit(defaultAhead, defaultBehind);
  }

  /** Whether one more decoded frame fits next to the `held` ones. */
  hasFreeSurface(held: number): boolean {
    return this.budget === null || held < this.budget;
  }
}

/** Decoded frames held open: the buffered ones plus the shown frame when it left the buffer. */
export function countHeldFrames(buffer: ReadonlyMap<number, VideoFrame>, shown: VideoFrame | null): number {
  return buffer.size + (shown && ![...buffer.values()].includes(shown) ? 1 : 0);
}

/**
 * Closes and removes the buffered frames before `beforeCtsUs`. The shown frame is closed only with
 * `releaseShown` (a foreground seek: it was rendered already). Returns how many were closed and
 * whether the shown frame was among them.
 */
export function releaseFramesBefore(
  buffer: Map<number, VideoFrame>,
  beforeCtsUs: number,
  shown: VideoFrame | null,
  releaseShown: boolean,
): { released: number; shownReleased: boolean } {
  let released = 0;
  let shownReleased = false;
  for (const [cts, frame] of buffer) {
    if (cts >= beforeCtsUs || (frame === shown && !releaseShown)) continue;
    try { frame.close(); } catch { /* already closed */ }
    buffer.delete(cts);
    released += 1;
    if (frame === shown) shownReleased = true;
  }
  return { released, shownReleased };
}
