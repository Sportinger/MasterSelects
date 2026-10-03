import { shareProjectedGraph } from '../../../../services/nodeGraph/unified/shareProjectedGraph';
import { useMemo, useRef } from 'react';
import { useTimelineStore } from '../../../../stores/timeline';
import { useMediaStore } from '../../../../stores/mediaStore';
import { buildCompositionGraph, type CompositionGraphMediaInfo } from '../../../../services/nodeGraph/composition/compositionGraphProjection';
import { withCompositionTrackPorts } from './compositionTrackPorts';
import { measureCompositionProjection } from '../../../../services/nodeGraph/composition/compositionGraphMetrics';
import { deriveCompositionTransitionParents } from '../../../../services/nodeGraph/composition/compositionTransitionParents';

/** Mounted only in the visible composition workspace; no playhead or meter subscriptions. */
export function useCompositionGraphSubject(compositionId: string, expandedTimeChains: ReadonlySet<string>, expandedClipSizes?: ReadonlyMap<string, { width: number; height: number }>, enabled = true) {
  const clips = useTimelineStore(state => state.clips);
  const tracks = useTimelineStore(state => state.tracks);
  const state = useTimelineStore(state => state.compositionGraph);
  const files = useMediaStore(state => state.files);
  const compositions = useMediaStore(state => state.compositions);
  const composition = compositions.find(comp => comp.id === compositionId);
  const name = composition?.name ?? 'Timeline';
  const transitionLink = composition?.transitionComp;
  const transitionSourceParents = useMemo(() => deriveCompositionTransitionParents(clips, transitionLink), [clips, transitionLink]);
  const media = useMemo(() => {
    const lookup = new Map<string, CompositionGraphMediaInfo>();
    for (const file of files) lookup.set(file.id, { id: file.id, name: file.name, duration: file.duration,
      kind: file.type === 'video' || file.type === 'audio' || file.type === 'image' ? file.type : 'other' });
    for (const comp of compositions) lookup.set(`comp:${comp.id}`, { id: `comp:${comp.id}`, name: comp.name, duration: comp.duration, kind: 'composition' });
    return lookup;
  }, [files, compositions]);
  // Metadata is sampled at projection time; unrelated media/status updates do not rebuild the graph.
  const mediaRef = useRef(media); mediaRef.current = media;
  const previousGraph = useRef<ReturnType<typeof buildCompositionGraph> | undefined>(undefined);
  const graph = useMemo(() => {
    const next = !enabled ? { id: '', owner: { kind: 'composition' as const, id: compositionId, name }, nodes: [], edges: [] } : withCompositionTrackPorts(measureCompositionProjection(() => buildCompositionGraph({ compositionId, compositionName: name,
    clips, tracks, state, expandedTimeChains, expandedClipSizes, duration: composition?.duration, media: mediaRef.current, transitionLink, transitionSourceParents })), clips, tracks);
    const shared = shareProjectedGraph(previousGraph.current, next); previousGraph.current = shared; return shared;
  },
  [compositionId, name, composition?.duration, clips, tracks, state, expandedTimeChains, expandedClipSizes, enabled, transitionLink, transitionSourceParents]);
  return { graph, clips, tracks, state };
}
