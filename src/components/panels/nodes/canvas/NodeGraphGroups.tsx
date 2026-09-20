import './NodeGraphGroups.css';
import type { CSSProperties } from 'react';
import type { NodeGraph, NodeGraphNode } from '../../../../types/nodeGraph';
import { nodeGroupBounds } from './groupBounds';

export function NodeGraphGroups({ graph, nodes, onToggle, onFocus }: {
  graph: NodeGraph; nodes: NodeGraphNode[]; onToggle?: (id: string) => void; onFocus?: (id: string) => void;
}) {
  const bounds = nodeGroupBounds(graph, nodes);
  return <>{graph.groups?.map(group => {
    const members = nodes.filter(n => group.nodeIds.includes(n.id));
    if (!members.length) return null;
    const box = bounds.get(group.id)!;
    const x = box.left, y = box.top, width = box.right - x, height = box.bottom - y;
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
