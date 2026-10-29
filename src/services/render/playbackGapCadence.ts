// Render cadence while playback crosses a gap (no visual clip at the playhead).
//
// The render callback keeps looking at the timeline there: its video sync warms, positions and
// pre-rolls the clip ahead and pauses the one that ended. That needs display rate only shortly
// before the next clip: the window covers the video sync's 1.5 s warmup lookahead at normal speed
// and starts the 0.25 s pre-roll on time. Further ahead (audio-only playback, a long gap at the
// end) a few callbacks per second are enough, and the playback loop wakes the render host on the
// frame the playhead enters a clip (also after a loop wrap or a seek). Playback never idles.

/** Wall-clock lead to the next visual clip from which a gap runs at display rate. */
export const PLAYBACK_GAP_FULL_RATE_LEAD_MS = 2000;
/** Callback interval while the next visual clip is further ahead (8 Hz). */
export const PLAYBACK_GAP_FAR_FRAME_TIME_MS = 125;

/** An unknown lead (NaN) counts as near: the callback runs at display rate until it reports one. */
export function isPlaybackGapNearVisualDemand(leadMs: number): boolean {
  return !(leadMs > PLAYBACK_GAP_FULL_RATE_LEAD_MS);
}
