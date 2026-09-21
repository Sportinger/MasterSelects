import { buildUnifiedClipGraph } from '../../../services/nodeGraph/unifiedClipGraph';
import { usePreciseFaceTrack } from '../../../services/landmarkTracking/usePreciseFaceTrack';
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
import type { TimelineClip, TimelineTrack } from '../../../types/timeline';
import { withLegacyKeyframeNodes } from '../../../services/nodeGraph/legacyKeyframeNodes';
import { buildEffectOperatorGraph } from '../../../services/nodeGraph/effectGraphProjection';
import { hasEffectOperatorGraph } from '../../../services/operators/effectGraphOwner';

const EMPTY_KEYFRAMES = [] as const;

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
  projectGroupStates?: (collapsed: Record<string, boolean>) => NodeGraph;
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
  const faceTracking = usePreciseFaceTrack(graphContext?.ownerClip.id ?? '');
  const keyframes = useTimelineStore(state => state.clipKeyframes.get(graphContext?.ownerClip.id ?? '') ?? EMPTY_KEYFRAMES);

  return useMemo(() => {
    if (!graphContext) {
      return null;
    }

    const graphClip = withLegacyKeyframeNodes(createNodeGraphOwnerClip(graphContext), keyframes);
    const document = buildClipNodeGraphDocument(graphClip, graphContext.ownerTrack ?? undefined, {
      linkedClip: graphContext.linkedClip,
      linkedTrack: graphContext.linkedTrack,
      faceTrackingAvailable: faceTracking.ready,
    });
    // Folding changes presentation only. Compile/project each effect once per
    // immutable subject, instead of again for every step of a 27-group animation.
    const preparedEffects = theme === 'general' ? new Map(graphClip.effects.filter(effect => hasEffectOperatorGraph(effect.type))
      .map(effect => [effect.id, buildEffectOperatorGraph(graphClip, effect)])) : undefined;
    const graph = theme === 'general' ? buildUnifiedClipGraph(document, graphClip, clips, keyframes, faceTracking.createdAt, false, preparedEffects) : getNodeGraphView(document, theme);
    const projectGroupStates = theme === 'general' ? (collapsed: Record<string, boolean>) => {
      const groups = { ...graphClip.nodeGraph?.groups };
      for (const [id, value] of Object.entries(collapsed)) groups[id] = { ...groups[id], collapsed: value };
      return buildUnifiedClipGraph(document, { ...graphClip, nodeGraph: { ...graphClip.nodeGraph,
        version: 1, nodes: graphClip.nodeGraph?.nodes ?? [], groups } }, clips, keyframes, faceTracking.createdAt, false, preparedEffects);
    } : undefined;
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
      projectGroupStates,
      document,
      view,
      availableViews: document.views,
    };
  }, [graphContext, theme, clips, faceTracking.ready, faceTracking.createdAt, keyframes]);
}
