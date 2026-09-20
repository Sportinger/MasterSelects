import { useCallback } from 'react';
import { useTimelineStore } from '../../../../stores/timeline';
import type { ClipNodeGraph } from '../../../../types/nodeGraph';
import { useMediaStore } from '../../../../stores/mediaStore';

const EMPTY: NonNullable<ClipNodeGraph['previews']> = { enabled: true, nodes: {} };

export function useNodePreviewPreferences(clipId: string) {
  const preferences = useTimelineStore(state => state.clips.find(clip => clip.id === clipId)?.nodeGraph?.previews ?? EMPTY);
  const clip = useTimelineStore(state => state.clips.find(value => value.id === clipId));
  const media = useMediaStore(state => state.files.find(value => value.id === (clip?.source?.mediaFileId ?? clip?.mediaFileId)));
  const source = clip?.source;
  const width = source?.videoElement?.videoWidth || source?.imageElement?.naturalWidth || source?.textCanvas?.width || media?.width || 1920;
  const height = source?.videoElement?.videoHeight || source?.imageElement?.naturalHeight || source?.textCanvas?.height || media?.height || 1080;
  const change = useCallback((edit: (current: typeof EMPTY) => typeof EMPTY) => {
    const state = useTimelineStore.getState(), clip = state.clips.find(candidate => candidate.id === clipId);
    if (!clip) return;
    state.updateClip(clipId, { nodeGraph: { ...clip.nodeGraph, version: 1, nodes: clip.nodeGraph?.nodes ?? [], previews: edit(clip.nodeGraph?.previews ?? EMPTY) } });
  }, [clipId]);
  const toggleGlobal = useCallback(() => change(current => ({ ...current, enabled: !current.enabled })), [change]);
  const toggleNode = useCallback((id: string) => change(current => ({ ...current,
    nodes: { ...current.nodes, [id]: { ...current.nodes[id], enabled: !(current.nodes[id]?.enabled ?? true) } } })), [change]);
  const selectOutput = useCallback((id: string, portId: string) => change(current => ({ ...current,
    nodes: { ...current.nodes, [id]: { enabled: true, portId } } })), [change]);
  return { preferences, toggleGlobal, toggleNode, selectOutput, aspectRatio: width / height };
}
