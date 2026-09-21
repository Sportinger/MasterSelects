import type { CSSProperties, PointerEvent } from 'react';
import type { NodeGraphNode, NodeGraphPort } from '../../../../types/nodeGraph';
import { describeNodePort } from '../../../../services/nodeGraph/nodePortPresentation';
import { getPortCenter, type ConnectionDraft } from './canvasGeometry';
import type { ConnectionPlug } from './connectionPlugs';
import type { HoveredNodePort } from './useNodePortHover';

interface Props {
  plugs: ConnectionPlug[]; nodes: NodeGraphNode[]; draft: ConnectionDraft | null;
  visiblePlugIds?: ReadonlySet<string>; hoveredPort: HoveredNodePort | null;
  onSelectEdge: (id: string) => void;
  onStartDrag: (event: PointerEvent, plug: ConnectionPlug) => void;
  onStartConnectionDrag: (event: PointerEvent, node: NodeGraphNode, port: NodeGraphPort) => void;
  onDisconnectEdge?: (id: string) => void;
}
function targetStyle(plug: Pick<ConnectionPlug, 'center' | 'tip' | 'port'>): CSSProperties {
  return { left: Math.min(plug.center.x, plug.tip.x) - 8, top: plug.center.y - 12,
    width: Math.abs(plug.tip.x - plug.center.x) + 16, height: 24,
    '--port-color': describeNodePort(plug.port).color } as CSSProperties;
}

/** Flat hit targets: all plug artwork is already painted by the canvas. */
export function NodeGraphPlugTargets({ plugs, nodes, draft, visiblePlugIds, hoveredPort,
  onSelectEdge, onStartDrag, onStartConnectionDrag, onDisconnectEdge }: Props) {
  const freeNode = draft ? nodes.find(node => node.id === draft.nodeId) : hoveredPort?.node;
  const freePort = draft ? [...(freeNode?.inputs ?? []), ...(freeNode?.outputs ?? [])]
    .find(port => port.id === draft.portId && port.direction === draft.direction) : hoveredPort?.port;
  const free = freeNode && freePort && !plugs.some(plug => plug.node.id === freeNode.id
    && plug.port.id === freePort.id && plug.port.direction === freePort.direction) ? { node: freeNode, port: freePort } : null;
  const center = free && getPortCenter(free.node, free.port.id, free.port.direction);
  return <>
    {plugs.toReversed().map(plug => {
      const { edge, node, port } = plug, key = `${edge.id}:${port.direction}`;
      if (visiblePlugIds && !visiblePlugIds.has(key)) return null;
      if (draft?.reconnectEdgeId === edge.id && draft.moved && draft.direction !== port.direction) return null;
      const other = nodes.find(n => n.id === (port.direction === 'input' ? edge.fromNodeId : edge.toNodeId));
      const label = `${node.label}, ${port.label}: cable ${port.direction === 'input' ? 'from' : 'to'} ${other?.label ?? 'connected node'}`;
      return <button key={key} type="button" className="node-workspace-plug node-workspace-plug-target"
        style={targetStyle(plug)} aria-label={label}
        aria-description={edge.readOnly ? 'Recorded bake dependency. Edit the stabilization or its curves in the inspector.' : 'Drag to reconnect; release on empty canvas to disconnect. Delete removes this cable. Escape cancels dragging.'}
        title={label} data-edge-id={edge.id} data-node-id={node.id} data-port-id={port.id} data-direction={port.direction}
        onPointerDown={event => onStartDrag(event, plug)}
        onClick={event => { event.stopPropagation(); onSelectEdge(edge.id); if (event.detail > 0) event.currentTarget.blur(); }}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); if (!edge.readOnly) onDisconnectEdge?.(edge.id); }
        }}
        onContextMenu={event => { event.preventDefault(); event.stopPropagation(); if (!edge.readOnly) onDisconnectEdge?.(edge.id); }} />;
    })}
    {free && center && <button type="button" tabIndex={-1} aria-hidden="true"
      className="node-workspace-plug node-workspace-plug-preview revealed node-workspace-plug-target"
      style={targetStyle({ center, tip: { x: center.x + (free.port.direction === 'input' ? -24 : 24), y: center.y }, port: free.port })}
      data-node-id={free.node.id} data-port-id={free.port.id} data-direction={free.port.direction}
      onPointerDown={event => onStartConnectionDrag(event, free.node, free.port)}
      onClick={event => { event.stopPropagation(); if (event.detail > 0) event.currentTarget.blur(); }} />}
  </>;
}
