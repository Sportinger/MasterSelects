import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { createKeyframeEffectInterpolationActions } from '../../../stores/timeline/keyframes/keyframeEffectInterpolationActions';
import type { TimelineClip } from '../../../types/timeline';
import type { Keyframe } from '../../../types/keyframes';

/** Freeze authored parameter inputs, not DOM/GPU/media runtime handles. */
export function captureExportParameterState() {
  const state = useTimelineStore.getState(), media = useMediaStore.getState();
  const clipKeyframes = structuredClone(state.clipKeyframes);
  const copyClip = (clip: TimelineClip): TimelineClip => {
    const storedKeys = (clip as TimelineClip & { keyframes?: Keyframe[] }).keyframes;
    return { ...clip, effects: structuredClone(clip.effects), colorCorrection: structuredClone(clip.colorCorrection),
      nodeGraph: structuredClone(clip.nodeGraph),
      ...{ keyframes: clipKeyframes.get(clip.id) ?? structuredClone(storedKeys ?? []) },
      ...(clip.nestedClips ? { nestedClips: clip.nestedClips.map(copyClip) } : {}) };
  };
  const clips = state.clips.map(copyClip);
  const timeline = { ...state, clips, clipKeyframes,
    getClipsAtTime: (time: number) => clips.filter(clip => time >= clip.startTime && time < clip.startTime + clip.duration) };
  const interpolation = createKeyframeEffectInterpolationActions(() => {}, () => timeline);
  return { timeline: { ...timeline, ...interpolation }, media: { ...media,
    compositions: media.compositions.map(comp => ({ ...comp, timelineData: structuredClone(comp.timelineData) })) } };
}
