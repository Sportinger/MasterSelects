import type { NodeGraph, NodeGraphNode } from '../../../../types/nodeGraph';
import { useTimelineStore } from '../../../../stores/timeline';
import { nodePreviewPreferenceKey } from '../../../../services/nodePreview/previewTypes';
import { clipWorkspaceBatch } from './useClipDomainAdapter';

export function changeWorkspacePreview(node: NodeGraphNode, portId?: string) {
  const owner = node.workspaceOwner; if (!owner) return;
  const state = useTimelineStore.getState(), clip = state.clips.find(clip => clip.id === owner.clipId);
  if (!clip) return;
  const preferences = clip.nodeGraph?.previews ?? { enabled: false, nodes: {} };
  const key = nodePreviewPreferenceKey(clip.id, { ...node, id: owner.localId });
  const before = preferences.nodes[key] ?? preferences.nodes[owner.localId];
  const value = portId ? { enabled: true, portId } : { ...before, enabled: !(before?.enabled ?? node.preview?.requested ?? preferences.enabled) };
  state.updateClip(clip.id, { nodeGraph: { ...clip.nodeGraph, version: 1, nodes: clip.nodeGraph?.nodes ?? [],
    previews: { ...preferences, nodes: { ...preferences.nodes, [key]: value } } } });
}
export function toggleWorkspacePreviews(graph: NodeGraph) {
  clipWorkspaceBatch('Toggle node previews', () => {
    const enabled = !graph.nodes.some(node => node.workspaceOwner && node.preview?.requested);
    for (const [clipId, entry] of Object.entries(graph.workspace?.clips ?? {})) {
      const state = useTimelineStore.getState(), clip = state.clips.find(clip => clip.id === clipId); if (!clip) continue;
      const nodes = { ...clip.nodeGraph?.previews?.nodes };
      for (const node of entry.graph.nodes) { const key = nodePreviewPreferenceKey(clipId, node); nodes[key] = { ...nodes[key], enabled }; }
      state.updateClip(clipId, { nodeGraph: { ...clip.nodeGraph, version: 1, nodes: clip.nodeGraph?.nodes ?? [], previews: { enabled, nodes } } });
    }
  });
}
