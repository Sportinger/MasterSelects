import './NodeGraphGroups.css';
import type { CSSProperties } from 'react';
import type { NodeGraph, NodeGraphNode } from '../../../../types/nodeGraph';
import { getNodeHeight, NODE_WIDTH } from './canvasGeometry';

export function NodeGraphGroups({ graph, nodes, onToggle, onFocus }: {
  graph: NodeGraph; nodes: NodeGraphNode[]; onToggle?: (id: string) => void; onFocus?: (id: string) => void;
}) {
  return <>{graph.groups?.map(group => {
    const members = nodes.filter(n => group.nodeIds.includes(n.id));
    if (!members.length) return null;
    const x = Math.min(...members.map(n => n.layout.x)) - 22, y = Math.min(...members.map(n => n.layout.y)) - 48;
    const width = Math.max(...members.map(n => n.layout.x + NODE_WIDTH)) - x + 22;
    const height = Math.max(...members.map(n => n.layout.y + getNodeHeight(n))) - y + 22;
    return <section key={group.id} aria-label={`${group.label} node group`} className="node-workspace-group"
      style={{ left: x, top: y, width, height, '--group-color': group.color } as CSSProperties}>
      <div className="node-workspace-group-header"><button type="button" className="node-workspace-group-toggle" aria-expanded={!group.collapsed}
        aria-label={`${group.collapsed ? 'Expand' : 'Collapse'} ${group.label} group`}
        onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); if (event.detail > 0) event.currentTarget.blur(); onToggle?.(group.id); }}>
        <span aria-hidden="true">{group.collapsed ? '▸' : '▾'}</span> {group.label}
        <span className="node-workspace-group-count">{group.collapsed ? 'Effect' : `${members.length} nodes`}</span>
      </button>
      <button type="button" className="node-workspace-group-focus" aria-label={`Focus ${group.label} group`}
        onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
        onClick={event => { event.stopPropagation(); if (event.detail > 0) event.currentTarget.blur(); onFocus?.(group.id); }}>Focus</button>
      </div>
    </section>;
  })}</>;
}
