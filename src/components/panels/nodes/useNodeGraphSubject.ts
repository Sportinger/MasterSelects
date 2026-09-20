import { buildUnifiedClipGraph } from '../../../services/nodeGraph/unifiedClipGraph';
import { useMemo } from 'react';
import type { NodeGraph, NodeGraphDocument, NodeGraphView, NodeGraphViewTheme } from '../../../services/nodeGraph';
import {
  buildClipNodeGraphDocument,
  getNodeGraphView,
} from '../../../services/nodeGraph/clipGraphProjection';
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
  document: NodeGraphDocument;
  view: NodeGraphView;
  availableViews: NodeGraphView[];
}

export type NodeGraphSubject = NodeGraphClipSubject;

export function useNodeGraphSubject(theme: NodeGraphViewTheme = 'general'): NodeGraphSubject | null {
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
    const document = buildClipNodeGraphDocument(graphClip, graphContext.ownerTrack ?? undefined, {
      linkedClip: graphContext.linkedClip,
      linkedTrack: graphContext.linkedTrack,
    });
    const graph = theme === 'general' ? buildUnifiedClipGraph(document, graphClip, clips) : getNodeGraphView(document, theme);
    const view = document.views.find((candidate) => candidate.theme === theme) ?? document.views[0];
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
      document,
      view,
      availableViews: document.views,
    };
  }, [graphContext, theme, clips]);
}
