import { useTimelineStore } from '../../stores/timeline';
import { useMediaStore } from '../../stores/mediaStore';
import type { EffectOperatorGraph } from '../../types/operatorGraph';
import type { TimelineClip } from '../../types/timeline';
import type { MarkerSample } from './controlSignalMath';
import type { MarkerParameterContext } from './markerParameterContext';

type OwnedClip = Pick<TimelineClip, 'id' | 'nodeGraph'> & Partial<Pick<TimelineClip, 'compositionId' | 'nestedClips'>>;

/**
 * Markers of the composition that owns the graph, read at request time. The active
 * composition lives in the timeline store; nested and inactive compositions keep theirs
 * in their saved timeline data. Unknown owners fall back to the active timeline.
 */
export function liveMarkerParameterContext(graph: EffectOperatorGraph, clipId?: string): MarkerParameterContext {
  const timeline = useTimelineStore.getState(), media = useMediaStore.getState();
  const owns = (clip: OwnedClip) => clip.nodeGraph?.parameterSources?.graph === graph || (clipId !== undefined && clip.id === clipId);
  const compositionMarkers = (id: string | undefined): readonly MarkerSample[] =>
    media.compositions.find(composition => composition.id === id)?.timelineData?.markers ?? [];
  const search = (clips: readonly OwnedClip[], markers: readonly MarkerSample[]): readonly MarkerSample[] | undefined => {
    for (const clip of clips) {
      if (owns(clip)) return markers;
      if (clip.nestedClips?.length) {
        const nested = search(clip.nestedClips, compositionMarkers(clip.compositionId));
        if (nested) return nested;
      }
    }
    return undefined;
  };
  const found = search(timeline.clips, timeline.markers);
  if (found) return found;
  for (const composition of media.compositions) {
    if (composition.id === media.activeCompositionId) continue;
    const clips = (composition.timelineData?.clips ?? []) as readonly OwnedClip[];
    if (clips.some(owns)) return composition.timelineData?.markers ?? [];
  }
  return timeline.markers;
}
