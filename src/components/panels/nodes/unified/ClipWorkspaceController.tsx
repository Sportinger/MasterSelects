import { useNodePreviewPreferences } from '../previews/useNodePreviewPreferences';
import { memo, useLayoutEffect, useMemo } from 'react';
import type { NodeGraphCanvasProps } from '../NodeGraphCanvas';
import { useClipWorkspaceController } from './useClipWorkspaceController';
import { reconcileCanvasPlacement } from '../canvas/nodeCanvasPlacement';
import { getGraphBounds, getNodeHeight } from '../canvas/canvasGeometry';
import { nodePreviewKey, nodePreviewPreferenceKey } from '../../../../services/nodePreview/previewTypes';
import { previewOutput } from '../../../../services/nodePreview/previewTypes';
import type { WorkspaceClipProjection } from '../../../../services/nodeGraph/unified/embedWorkspaceGraph';

export type ClipWorkspaceControllerValue = NonNullable<ReturnType<typeof useClipWorkspaceController>> & {
  canvasProps: NodeGraphCanvasProps;
  projection: WorkspaceClipProjection;
};

/** Headless adapter: only expanded clips mount it. The shared workspace mounts all UI. */
export const ClipWorkspaceController = memo(function ClipWorkspaceController({ clipId, panelId, inline, onChange }: {
  clipId: string; panelId: string; inline: boolean;
  onChange: (clipId: string, controller: ClipWorkspaceControllerValue | null) => void;
}) {
  const controller = useClipWorkspaceController(clipId, inline ? `${panelId}:inline:${clipId}` : panelId);
  const { aspectRatio } = useNodePreviewPreferences(clipId);
  const source = (controller?.canvas.props as NodeGraphCanvasProps | undefined)?.graph;
  const clip = controller?.subject.clip;
  const projection = useMemo(() => {
    if (!source || !clip) return null;
    const preferences = clip.nodeGraph?.previews;
    const prepared = { ...source, nodes: source.nodes.map(node => {
      const preference = preferences?.nodes[nodePreviewPreferenceKey(clipId, node)] ?? preferences?.nodes[node.id];
      const output = previewOutput(node, preference?.portId);
      const enabled = preference?.enabled ?? preferences?.enabled ?? !inline;
      return { ...node, preview: { enabled, requested: enabled, portId: output?.id,
        key: nodePreviewKey(clipId, node, output?.id), aspectRatio } };
    }) };
    const placement = reconcileCanvasPlacement(prepared, clip.nodeGraph?.canvasPlacements?.[source.id]);
    const graph = { ...prepared, nodes: prepared.nodes.map(node => ({ ...node, layout: placement.nodes[node.id] ?? node.layout })) };
    const bounds = getGraphBounds(graph);
    // Leave room for seam ports and the containing group header.
    bounds.bottom = Math.max(bounds.bottom, ...graph.nodes.map(node => node.layout.y + getNodeHeight(node) + 100));
    return { graph, placement, bounds };
  }, [source, clip, clipId, inline, aspectRatio]);
  useLayoutEffect(() => {
    onChange(clipId, controller && projection ? { ...controller, projection, canvasProps: controller.canvas.props as NodeGraphCanvasProps } : null);
  }, [clipId, controller, projection, onChange]);
  useLayoutEffect(() => () => onChange(clipId, null), [clipId, onChange]);
  return null;
});
