import type { NodeGraphLayout } from '../../../types/nodeGraph';
import type { TimelineClip } from '../../../types/timeline';
import type { CompositionGraphProjectionInput } from './compositionGraphProjection';
import { finite } from './compositionGraphPrimitives';

export const TRACK_STRIP_WIDTH = 1620;
export const TRACK_STRIP_X = 300;
export const TRACK_STRIP_PITCH = 216;

/** One shared time axis. Card drags remain independent presentation coordinates. */
export function compositionGraphLayout(input: CompositionGraphProjectionInput, videoByAudio?: ReadonlyMap<string, TimelineClip>) {
  // Scale to the used content, not the (often much longer) composition length; an
  // empty composition still gets its nominal duration so the strips keep a scale.
  let contentEnd = 0;
  for (const clip of input.clips) contentEnd = Math.max(contentEnd, finite(clip.startTime) + Math.max(0, finite(clip.duration)));
  const duration = contentEnd > 0 ? contentEnd * 1.03
    : Math.max(0, finite(input.duration ?? input.media.get(`comp:${input.compositionId}`)?.duration));
  const pixelsPerSecond = (TRACK_STRIP_WIDTH - 20) / (duration > 0 ? duration : 1);
  const tracks = new Map<string, number>();
  let height = 80;
  for (const type of ['video', 'audio']) for (const track of input.tracks) if (track.type === type) {
    tracks.set(track.id, height); height += TRACK_STRIP_PITCH;
  }
  const positions = new Map<string, NodeGraphLayout>();
  for (const clip of input.clips) {
    if (videoByAudio?.has(clip.id)) continue;
    positions.set(clip.id, { x: TRACK_STRIP_X + 10 + finite(clip.startTime) * pixelsPerSecond,
      y: (tracks.get(clip.trackId) ?? height) + TRACK_STRIP_PITCH });
  }
  return { clips: positions, tracks, trackX: TRACK_STRIP_X, width: TRACK_STRIP_WIDTH,
    busX: TRACK_STRIP_X + TRACK_STRIP_WIDTH + 100, height, duration, pixelsPerSecond };
}
