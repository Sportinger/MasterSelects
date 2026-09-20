import type { NodeGraphEdge, NodeGraphNode } from '../../../../services/nodeGraph';
import { memo, type CSSProperties } from 'react';
import { describeNodePort } from '../../../../services/nodeGraph/nodePortPresentation';
import type { ConnectionDraft, NodeBounds } from './canvasGeometry';
import { getConnectionArrowTransform, getConnectionPath, getPortCenter } from './canvasGeometry';
import type { ConnectionPlug } from './connectionPlugs';
import { useNodeFlowActivity } from './useNodeFlowActivity';
import { NodeGraphFlowSignals } from './NodeGraphFlowSignals';
import './NodeGraphFlow.css';

interface NodeGraphEdgesProps {
  graphBounds: NodeBounds;
  edges: NodeGraphEdge[];
  plugs: ConnectionPlug[];
  nodesById: Map<string, NodeGraphNode>;
  selectedEdgeId: string | null;
  hoveredEdgeId: string | null;
  connectionDraft: ConnectionDraft | null;
  onSelectEdge: (edgeId: string) => void;
  onClearSelectedEdge: () => void;
  onDisconnectEdge?: (edgeId: string) => void;
  zoom: number;
  canvasRendered?: boolean;
}

export const NodeGraphEdges = memo(function NodeGraphEdges({
  graphBounds,
  edges,
  plugs,
  nodesById,
  selectedEdgeId,
  hoveredEdgeId,
  connectionDraft,
  onSelectEdge,
  onClearSelectedEdge,
  onDisconnectEdge,
  zoom,
  canvasRendered = false,
}: NodeGraphEdgesProps) {
  const flowRef = useNodeFlowActivity();
  const endpoints = new Map<string, { input?: ConnectionPlug; output?: ConnectionPlug }>();
  for (const plug of plugs) {
    const pair = endpoints.get(plug.edge.id) ?? {};
    pair[plug.port.direction] = plug;
    endpoints.set(plug.edge.id, pair);
  }
  const svgLeft = graphBounds.left - 96;
  const svgTop = graphBounds.top - 96;
  const svgWidth = graphBounds.right - graphBounds.left + 192;
  const svgHeight = graphBounds.bottom - graphBounds.top + 192;

  const draftPair = connectionDraft?.reconnectEdgeId ? endpoints.get(connectionDraft.reconnectEdgeId) : undefined;
  const draftNode = connectionDraft && nodesById.get(connectionDraft.nodeId);
  const draftPort = (connectionDraft?.direction === 'input' ? draftNode?.inputs : draftNode?.outputs)?.find(p => p.id === connectionDraft?.portId);
  const draftStart = connectionDraft && (draftPair?.[connectionDraft.direction]?.tip ?? {
    x: connectionDraft.start.x + (connectionDraft.direction === 'input' ? -24 : 24), y: connectionDraft.start.y,
  });
  const targetNode = connectionDraft?.target && nodesById.get(connectionDraft.target.nodeId);
  const dockedCenter = targetNode && connectionDraft?.target
    ? getPortCenter(targetNode, connectionDraft.target.portId, connectionDraft.target.direction) : null;
  const draftEnd = dockedCenter ?? connectionDraft?.end;
  const draftTip = connectionDraft && draftEnd && {
    x: draftEnd.x + (connectionDraft.direction === 'output' ? -1 : 1) * (dockedCenter ? 24 : 21), y: draftEnd.y,
  };
  const draftPath = connectionDraft && draftStart && draftTip && (!connectionDraft.reconnectEdgeId || connectionDraft.moved)
    ? connectionDraft.direction === 'output' ? getConnectionPath(draftStart, draftTip) : getConnectionPath(draftTip, draftStart)
    : null;
  return <>
    <svg
      ref={flowRef}
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
        const pair = endpoints.get(edge.id);
        if (!pair?.input || !pair.output || (connectionDraft?.reconnectEdgeId === edge.id && connectionDraft.moved)) return null;
        const path = getConnectionPath(pair.output.tip, pair.input.tip);
        const port = nodesById.get(edge.fromNodeId)?.outputs.find(p => p.id === edge.fromPortId);
        return (
          <g
            key={edge.id}
            className="node-workspace-edge-group"
            data-edge-id={edge.id}
            style={{ '--port-color': port ? describeNodePort(port).color : undefined } as CSSProperties}
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
                edge.id === hoveredEdgeId ? 'hovered' : '',
              ].filter(Boolean).join(' ')}
              d={path}
            />
            <g className="node-workspace-edge-flow">
              <path className="node-workspace-flow-arrow" d="M -4 -4 L 0 0 L -4 4"
                transform={getConnectionArrowTransform(pair.output.tip, pair.input.tip)} />
            </g>
          </g>
        );
      })}
    </svg>
    {!canvasRendered && <NodeGraphFlowSignals plugs={plugs} zoom={zoom}
      hiddenEdgeId={connectionDraft?.moved ? connectionDraft.reconnectEdgeId : undefined} />}
    {draftPath && connectionDraft && <svg className="node-workspace-edges node-workspace-edge-drag-layer" width="1" height="1" aria-hidden="true"
      style={{ '--port-color': draftPort ? describeNodePort(draftPort).color : undefined } as CSSProperties}>
        <path
          className={`node-workspace-edge port-typed node-workspace-edge-${connectionDraft.type} node-workspace-edge-draft`}
          d={draftPath}
        />
        {!dockedCenter && <g className="node-workspace-draft-plug" transform={`translate(${connectionDraft.end.x} ${connectionDraft.end.y}) scale(${connectionDraft.direction === 'output' ? -1 : 1} 1)`}>
          <path className="node-workspace-plug-backing" d="M 0 -6 A 6 6 0 0 1 0 6 M 6 0 H 16" />
          <path className="node-workspace-plug-shape" d="M 0 -6 A 6 6 0 0 1 0 6 M 6 0 H 16" />
          <rect className="node-workspace-plug-grip" x={12} y={-3} width={9} height={6} rx={2} />
        </g>}
    </svg>}
  </>;
});
