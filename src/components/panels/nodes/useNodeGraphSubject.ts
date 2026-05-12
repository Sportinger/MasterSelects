import { useMemo } from 'react';
import { buildClipNodeGraph, type NodeGraph } from '../../../services/nodeGraph';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineClip, TimelineTrack } from '../../../types';

export interface NodeGraphClipSubject {
  kind: 'clip';
  id: string;
  name: string;
  subtitle: string;
  clip: TimelineClip;
  track: TimelineTrack | null;
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

  const selectedClip = selectedClipId
    ? clips.find((clip) => clip.id === selectedClipId) ?? null
    : null;
  const selectedTrack = selectedClip
    ? tracks.find((track) => track.id === selectedClip.trackId) ?? null
    : null;

  return useMemo(() => {
    if (!selectedClip) {
      return null;
    }

    const graph = buildClipNodeGraph(selectedClip, selectedTrack ?? undefined);
    return {
      kind: 'clip',
      id: selectedClip.id,
      name: selectedClip.name,
      subtitle: selectedTrack ? `${selectedTrack.name} / ${selectedTrack.type}` : 'Timeline clip',
      clip: selectedClip,
      track: selectedTrack,
      graph,
    };
  }, [selectedClip, selectedTrack]);
}
