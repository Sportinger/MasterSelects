import type { NodeGraph } from '../../../types/nodeGraph';
/** Namespaces are presentation-only. Decode before entering any clip service. */
export const workspaceClipId = (clipId: string, localId: string) => `clip:${encodeURIComponent(clipId)}::${localId}`;
export function workspaceClipOwner(id: string): { clipId: string; localId: string } | null {
  if (!id.startsWith('clip:')) return null;
  const split = id.indexOf('::', 5);
  if (split < 0) return null;
  try {
    const clipId = decodeURIComponent(id.slice(5, split)), localId = id.slice(split + 2);
    return clipId && localId ? { clipId, localId } : null;
  } catch { return null; }
}
export const workspaceClipGroup = (clipId: string) => `comp:clip:${clipId}:processing`;

export function resolveWorkspaceClipOwner(graph: NodeGraph, id: string) {
  const owner = workspaceClipOwner(id);
  return owner && graph.workspace?.clips[owner.clipId] ? owner : null;
}
