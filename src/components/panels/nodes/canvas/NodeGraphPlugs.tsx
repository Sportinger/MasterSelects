import { memo, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { describeNodePort } from '../../../../services/nodeGraph/nodePortPresentation';
import type { NodeGraphNode, NodeGraphPort } from '../../../../types/nodeGraph';
import { getPortCenter, type ConnectionDraft } from './canvasGeometry';
import type { ConnectionPlug } from './connectionPlugs';
import type { HoveredNodePort } from './useNodePortHover';
import './NodeGraphPlugs.css';

interface Props {
  plugs: ConnectionPlug[];
  nodes: NodeGraphNode[];
  draft: ConnectionDraft | null;
  hoveredPort: HoveredNodePort | null;
  hoveredEdgeId: string | null;
  selectedEdgeId: string | null;
  onSelectEdge: (id: string) => void;
  onStartDrag: (event: ReactPointerEvent<SVGGElement>, plug: ConnectionPlug) => void;
  onStartConnectionDrag: (event: ReactPointerEvent, node: NodeGraphNode, port: NodeGraphPort) => void;
  onDisconnectEdge?: (id: string) => void;
}

export const NodeGraphPlugs = memo(function NodeGraphPlugs({ plugs, nodes, draft, hoveredPort, hoveredEdgeId, selectedEdgeId, onSelectEdge, onStartDrag, onStartConnectionDrag, onDisconnectEdge }: Props) {
  const occupied = new Set(plugs.map(p => JSON.stringify([p.node.id, p.port.id, p.port.direction])));
  const previews = nodes.flatMap(node => [...node.inputs, ...node.outputs]
    .filter(port => !occupied.has(JSON.stringify([node.id, port.id, port.direction])))
    .map(port => ({ node, port })));
  const targetNode = draft?.target && nodes.find(node => node.id === draft.target!.nodeId);
  const targetCenter = targetNode && draft?.target && getPortCenter(targetNode, draft.target.portId, draft.target.direction);
  const targetSign = draft?.target?.direction === 'input' ? -1 : 1;
  const ghostPath = `M 0 -6 A 6 6 0 0 ${targetSign < 0 ? 0 : 1} 0 6 M ${targetSign * 6} 0 H ${targetSign * 24}`;
  const targetPort = (draft?.target?.direction === 'input' ? targetNode?.inputs : targetNode?.outputs)?.find(port => port.id === draft?.target?.portId);
  return <svg className="node-workspace-plugs" width="1" height="1">
    {plugs.toReversed().map(plug => {
      const { edge, node, port, center, tip } = plug;
      const unplugging = draft?.reconnectEdgeId === edge.id && draft.moved && draft.direction !== port.direction;
      const hovered = hoveredPort?.node.id === node.id && hoveredPort.port.id === port.id && hoveredPort.port.direction === port.direction;
      const sign = port.direction === 'input' ? -1 : 1;
      const other = nodes.find(n => n.id === (port.direction === 'input' ? edge.fromNodeId : edge.toNodeId));
      const label = `${node.label}, ${port.label}: cable ${port.direction === 'input' ? 'from' : 'to'} ${other?.label ?? 'connected node'}`;
      const path = `M 0 -6 A 6 6 0 0 ${sign < 0 ? 0 : 1} 0 6 M ${sign * 6} 0 H ${tip.x - center.x}`;
      return <g key={`${edge.id}:${port.direction}`} role="button" tabIndex={0}
        className={`node-workspace-plug${selectedEdgeId === edge.id ? ' selected' : ''}${hovered && !hoveredEdgeId ? ' port-hovered' : ''}${hoveredEdgeId === edge.id ? ' edge-hovered' : ''}${unplugging ? ' unplugging' : ''}`}
        style={{ '--port-color': describeNodePort(port).color, '--plug-offset': `${sign * 10}px` } as CSSProperties}
        transform={`translate(${center.x} ${center.y})`}
        data-edge-id={edge.id} data-node-id={node.id} data-port-id={port.id} data-direction={port.direction}
        aria-label={label}
        aria-description={edge.readOnly ? 'Recorded bake dependency. Edit the stabilization or its curves in the inspector.' : 'Drag to reconnect; release on empty canvas to disconnect. Delete removes this cable. Escape cancels dragging.'}
        onPointerDown={event => onStartDrag(event, plug)}
        onClick={event => { event.stopPropagation(); onSelectEdge(edge.id); if (event.detail > 0) event.currentTarget.blur(); }}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); if (!edge.readOnly) onDisconnectEdge?.(edge.id); }
          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectEdge(edge.id); }
        }}
        onContextMenu={event => { event.preventDefault(); event.stopPropagation(); if (!edge.readOnly) onDisconnectEdge?.(edge.id); }}>
        <title>{`${label} — ${edge.readOnly ? 'recorded bake dependency' : 'drag to reconnect or unplug'}`}</title>
        <g className="node-workspace-plug-visual">
          <path className="node-workspace-plug-backing" d={path} />
          <path className="node-workspace-plug-shape" d={path} />
          <rect className="node-workspace-plug-grip" x={tip.x - center.x - 5} y={-3} width={10} height={6} rx={2} />
        </g>
        <path className="node-workspace-plug-collar-hit" d={path} />
        <rect className="node-workspace-plug-hit" x={tip.x - center.x - 8} y={-12} width={16} height={24} rx={4} />
      </g>;
    })}
    {previews.map(({ node, port }) => {
      const active = draft
        ? !draft.reconnectEdgeId && draft.nodeId === node.id && draft.portId === port.id && draft.direction === port.direction
        : hoveredPort?.node.id === node.id && hoveredPort.port.id === port.id && hoveredPort.port.direction === port.direction;
      const center = getPortCenter(node, port.id, port.direction), sign = port.direction === 'input' ? -1 : 1;
      const path = `M 0 -6 A 6 6 0 0 ${sign < 0 ? 0 : 1} 0 6 M ${sign * 6} 0 H ${sign * 24}`;
      return <g key={JSON.stringify([node.id, port.id, port.direction])}
        className={`node-workspace-plug node-workspace-plug-preview${active ? ' revealed' : ''}`}
        style={{ '--port-color': describeNodePort(port).color, '--plug-offset': `${sign * 10}px` } as CSSProperties}
        transform={`translate(${center.x} ${center.y})`} aria-hidden="true"
        data-node-id={node.id} data-port-id={port.id} data-direction={port.direction}
        onPointerDown={event => onStartConnectionDrag(event, node, port)} onClick={event => event.stopPropagation()}>
        <g className="node-workspace-plug-visual">
          <path className="node-workspace-plug-backing" d={path} />
          <path className="node-workspace-plug-shape" d={path} />
          <rect className="node-workspace-plug-grip" x={sign * 24 - 5} y={-3} width={10} height={6} rx={2} />
        </g>
        <path className="node-workspace-plug-collar-hit" d={path} />
        <rect className="node-workspace-plug-hit" x={sign * 24 - 8} y={-12} width={16} height={24} rx={4} />
      </g>;
    })}
    {targetCenter && targetPort && <g
      key={`${draft!.target!.nodeId}:${targetPort.id}:${targetPort.direction}`}
      className="node-workspace-plug-ghost" aria-hidden="true"
      data-node-id={draft!.target!.nodeId} data-port-id={targetPort.id}
      style={{ '--port-color': describeNodePort(targetPort).color, '--plug-offset': `${targetSign * 10}px` } as CSSProperties}
      transform={`translate(${targetCenter.x} ${targetCenter.y})`}>
      <g className="node-workspace-plug-visual">
        <path className="node-workspace-plug-backing" d={ghostPath} />
        <path className="node-workspace-plug-shape" d={ghostPath} />
        <rect className="node-workspace-plug-grip" x={targetSign * 24 - 5} y={-3} width={10} height={6} rx={2} />
      </g>
    </g>}
  </svg>;
});
