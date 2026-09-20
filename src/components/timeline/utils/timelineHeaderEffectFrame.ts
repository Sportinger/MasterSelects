import type { HeaderKeyframe, KeyframeTrackClip } from './timelineHeaderPropertyTypes';

type InterpolatedHeaderEffects = Array<{ id: string; type: string; name: string; params: Record<string, unknown> }>;
type HeaderEffectReader = (clipId: string, clipLocalTime: number) => InterpolatedHeaderEffects;

// All expanded effect rows share the latest interpolation for their clip.
// Weak ownership releases cached frames when the clip object is replaced.
const frames = new WeakMap<KeyframeTrackClip, {
  time: number; clipId: string; keys: HeaderKeyframe[]; read: HeaderEffectReader; effects: InterpolatedHeaderEffects;
}>();

export function readTimelineHeaderEffects(clip: KeyframeTrackClip, clipId: string, time: number,
  keys: HeaderKeyframe[], read: HeaderEffectReader): InterpolatedHeaderEffects {
  let frame = frames.get(clip);
  if (!frame || frame.time !== time || frame.clipId !== clipId || frame.keys !== keys || frame.read !== read) {
    frame = { time, clipId, keys, read, effects: read(clipId, time) };
    frames.set(clip, frame);
  }
  return frame.effects;
}
