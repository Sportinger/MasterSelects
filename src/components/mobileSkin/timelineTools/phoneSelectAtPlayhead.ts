// "Select the clip at the playhead": the next step an empty clip sheet offers. Picks the topmost
// visible clip under the playhead (video before audio, upper track first) and selects it.
import { useTimelineStore } from '../../../stores/timeline';

/** Id of the clip under the playhead, or null when the playhead is over an empty spot. */
export function phoneClipAtPlayhead(): string | null {
  const state = useTimelineStore.getState();
  const time = state.playheadPosition;
  const order = new Map(state.tracks.map((track, index) => [track.id, index]));
  const hit = state.clips
    .filter((clip) => time >= clip.startTime && time < clip.startTime + clip.duration)
    .toSorted((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0));
  return hit[0]?.id ?? null;
}

export const PHONE_NO_CLIP_AT_PLAYHEAD = 'No clip lies under the playhead. Move the playhead onto a clip, or tap a clip on the timeline.';

/** Selects the clip under the playhead; false when there is none. */
export function selectPhoneClipAtPlayhead(): boolean {
  const id = phoneClipAtPlayhead();
  if (!id) return false;
  useTimelineStore.getState().selectClips([id], { revealProperties: false });
  return true;
}
