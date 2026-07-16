import { useMemo } from 'react';
import type { NodeGraph } from '../../../services/nodeGraph';
import { buildClipNodeGraph } from '../../../services/nodeGraph/clipGraphProjection';
import {
  createNodeGraphOwnerClip,
  resolveLinkedClipNodeGraphContext,
} from '../../../services/nodeGraph/clipGraphLinking';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip, TimelineTrack } from '../../../types';

export interface NodeGraphClipSubject {
  kind: 'clip';
  id: string;
  name: string;
  subtitle: string;
  clip: TimelineClip;
  track: TimelineTrack | null;
  selectedClip: TimelineClip;
  linkedClip: TimelineClip | null;
  graph: NodeGraph;
}

export type NodeGraphSubject = NodeGraphClipSubject;

export function useNodeGraphSubject(): NodeGraphSubject | null {
  const clips = useTimelineStore((state) => state.clips);
  const tracks = useTimelineStore((state) => state.tracks);
  const selectedClipIds = useTimelineStore((state) => state.selectedClipIds);
  const primarySelectedClipId = useTimelineStore((state) => state.primarySelectedClipId);

  const selectedClipId = primarySelectedClipId && selectedClipIds.has(primarySelectedClipId)
    ? primarySelectedClipId
    : selectedClipIds.size > 0 ? [...selectedClipIds][0] : null;

  const graphContext = useMemo(
    () => resolveLinkedClipNodeGraphContext(clips, tracks, selectedClipId),
    [clips, tracks, selectedClipId],
  );

  return useMemo(() => {
    if (!graphContext) {
      return null;
    }

    const graphClip = createNodeGraphOwnerClip(graphContext);
    const graph = buildClipNodeGraph(graphClip, graphContext.ownerTrack ?? undefined, {
      linkedClip: graphContext.linkedClip,
      linkedTrack: graphContext.linkedTrack,
    });
    const linkedSubtitle = graphContext.linkedClip && graphContext.linkedTrack
      ? ` + ${graphContext.linkedTrack.name} / ${graphContext.linkedTrack.type}`
      : '';

    return {
      kind: 'clip',
      id: graphClip.id,
      name: graphClip.name,
      subtitle: graphContext.ownerTrack
        ? `${graphContext.ownerTrack.name} / ${graphContext.ownerTrack.type}${linkedSubtitle}`
        : 'Timeline clip',
      clip: graphClip,
      track: graphContext.ownerTrack,
      selectedClip: graphContext.selectedClip,
      linkedClip: graphContext.linkedClip,
      graph,
    };
  }, [graphContext]);
}
