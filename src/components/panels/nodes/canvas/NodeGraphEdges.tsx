import type { NodeGraphEdge, NodeGraphNode } from '../../../../services/nodeGraph';
import type { CSSProperties } from 'react';
import { describeNodePort } from '../../../../services/nodeGraph/nodePortPresentation';
import type { ConnectionDraft, NodeBounds } from './canvasGeometry';
import { getConnectionPath, getEdgePath } from './canvasGeometry';

interface NodeGraphEdgesProps {
  graphBounds: NodeBounds;
  edges: NodeGraphEdge[];
  nodesById: Map<string, NodeGraphNode>;
  selectedEdgeId: string | null;
  connectionDraft: ConnectionDraft | null;
  onSelectEdge: (edgeId: string) => void;
  onClearSelectedEdge: () => void;
  onDisconnectEdge?: (edgeId: string) => void;
}

export function NodeGraphEdges({
  graphBounds,
  edges,
  nodesById,
  selectedEdgeId,
  connectionDraft,
  onSelectEdge,
  onClearSelectedEdge,
  onDisconnectEdge,
}: NodeGraphEdgesProps) {
  const svgLeft = graphBounds.left - 96;
  const svgTop = graphBounds.top - 96;
  const svgWidth = graphBounds.right - graphBounds.left + 192;
  const svgHeight = graphBounds.bottom - graphBounds.top + 192;

  return (
    <svg
      className="node-workspace-edges"
      style={{
        left: svgLeft,
        top: svgTop,
        width: svgWidth,
        height: svgHeight,
      }}
      viewBox={`${svgLeft} ${svgTop} ${svgWidth} ${svgHeight}`}
      aria-hidden="true"
    >
      {edges.map((edge) => {
        const path = getEdgePath(edge, nodesById);
        if (!path) return null;
        const port = nodesById.get(edge.fromNodeId)?.outputs.find(p => p.id === edge.fromPortId);
        return (
          <g
            key={edge.id}
            className="node-workspace-edge-group"
            onClick={(event) => {
              event.stopPropagation();
              onSelectEdge(edge.id);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDisconnectEdge?.(edge.id);
              onClearSelectedEdge();
            }}
          >
            <path className="node-workspace-edge-hit" d={path} />
            <path
              className={[
                'node-workspace-edge port-typed',
                `node-workspace-edge-${edge.type}`,
                edge.id === selectedEdgeId ? 'selected' : '',
              ].filter(Boolean).join(' ')}
              d={path}
              style={{ '--port-color': port ? describeNodePort(port).color : undefined } as CSSProperties}
            />
          </g>
        );
      })}
      {connectionDraft && (
        <path
          className={`node-workspace-edge node-workspace-edge-${connectionDraft.type} node-workspace-edge-draft`}
          d={getConnectionPath(connectionDraft.start, connectionDraft.end)}
        />
      )}
    </svg>
  );
}
