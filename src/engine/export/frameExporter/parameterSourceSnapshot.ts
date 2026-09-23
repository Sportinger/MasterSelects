import { useTimelineStore } from '../../../stores/timeline';
import { useMediaStore } from '../../../stores/mediaStore';
import { createKeyframeEffectInterpolationActions } from '../../../stores/timeline/keyframes/keyframeEffectInterpolationActions';
import type { TimelineClip } from '../../../types/timeline';
import type { Keyframe } from '../../../types/keyframes';
import { freezeAudioParameterContext } from '../../../services/parameterSources/audioParameterContext';
import { liveAudioParameterContext, prepareAudioParameterGraphs } from '../../../services/parameterSources/audioParameterRuntime';
import type { EffectOperatorGraph } from '../../../types/operatorGraph';

/** Freeze authored parameter inputs, not DOM/GPU/media runtime handles. */
export async function captureExportParameterState() {
  const graphs: EffectOperatorGraph[] = [];
  const collect = (clips: readonly Pick<TimelineClip, 'nodeGraph' | 'nestedClips'>[]) => {
    for (const clip of clips) {
      if (clip.nodeGraph?.parameterSources) graphs.push(clip.nodeGraph.parameterSources.graph);
      if (clip.nestedClips) collect(clip.nestedClips);
    }
  };
  collect(useTimelineStore.getState().clips);
  for (const comp of useMediaStore.getState().compositions) collect(comp.timelineData?.clips ?? []);
  await prepareAudioParameterGraphs(graphs);
  const state = useTimelineStore.getState(), media = useMediaStore.getState();
  const clipKeyframes = structuredClone(state.clipKeyframes);
  const copyClip = (clip: TimelineClip): TimelineClip => {
    const storedKeys = (clip as TimelineClip & { keyframes?: Keyframe[] }).keyframes;
    const copy = { ...clip, effects: structuredClone(clip.effects), colorCorrection: structuredClone(clip.colorCorrection),
      nodeGraph: structuredClone(clip.nodeGraph),
      ...{ keyframes: clipKeyframes.get(clip.id) ?? structuredClone(storedKeys ?? []) },
      ...(clip.nestedClips ? { nestedClips: clip.nestedClips.map(copyClip) } : {}) };
    const graph = copy.nodeGraph?.parameterSources?.graph;
    if (graph) freezeAudioParameterContext(graph, liveAudioParameterContext(graph, false));
    return copy;
  };
  const clips = state.clips.map(copyClip);
  const timeline = { ...state, clips, clipKeyframes,
    getClipsAtTime: (time: number) => clips.filter(clip => time >= clip.startTime && time < clip.startTime + clip.duration) };
  const interpolation = createKeyframeEffectInterpolationActions(() => {}, () => timeline);
  const compositions = media.compositions.map(comp => {
    const timelineData = structuredClone(comp.timelineData);
    for (const clip of timelineData?.clips ?? []) {
      const graph = clip.nodeGraph?.parameterSources?.graph;
      if (graph) freezeAudioParameterContext(graph, liveAudioParameterContext(graph, false));
    }
    return { ...comp, timelineData };
  });
  return { timeline: { ...timeline, ...interpolation }, media: { ...media,
    compositions } };
}
