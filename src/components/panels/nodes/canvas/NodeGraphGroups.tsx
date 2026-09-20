import './NodeGraphGroups.css';
import { memo, type CSSProperties, type PointerEvent } from 'react';
import type { NodeGraph, NodeGraphNode } from '../../../../types/nodeGraph';
import { nodeGroupBounds } from './groupBounds';
import { groupHeaderMetrics } from './groupHeaderMetrics';

interface Props {
  graph: NodeGraph; nodes: NodeGraphNode[]; zoom?: number;
  frameNodes?: NodeGraphNode[];
  onToggle?: (id: string) => void; onFocus?: (id: string) => void; onToggleNodeBypass?: (id: string) => void;
  locks?: Record<string, { locked?: boolean }>; onToggleLock?: (id: string) => void;
  onStartDrag?: (event: PointerEvent<HTMLDivElement>, id: string) => void;
  onPointerMove?: (event: PointerEvent<HTMLDivElement>) => void;
  onFinishDrag?: (event: PointerEvent<HTMLDivElement>) => void;
}

export const NodeGraphGroups = memo(function NodeGraphGroups({ graph, nodes, zoom = 1, onToggle, onFocus, onToggleNodeBypass,
  onStartDrag, onPointerMove, onFinishDrag, locks, onToggleLock, frameNodes }: Props) {
  const bounds = nodeGroupBounds(graph, frameNodes ?? nodes), header = groupHeaderMetrics(zoom);
  return <>{graph.groups?.map(group => {
    const box = bounds.get(group.id);
    if (!box) return null;
    const members = nodes.filter(node => group.nodeIds.includes(node.id));
    return <section key={group.id} aria-label={`${group.label} node group`} className="node-workspace-group"
      style={{ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top, '--group-color': group.color,
        '--group-header-height': `${header.height}px`, '--group-font-size': `${header.fontSize}px`, '--group-icon-size': `${header.iconSize}px`,
        '--group-control-size': `${header.controlSize}px`, '--group-gap': `${header.gap}px`, '--group-padding': `${header.padding}px`,
        '--group-focus-width': `${2 / zoom}px` } as CSSProperties}>
      <div className="node-workspace-group-header" title={`Drag to move ${group.label} group`} data-compact={(box.right - box.left) * zoom < 250}
        onPointerDown={event => onStartDrag?.(event, group.id)} onPointerMove={onPointerMove}
        onPointerUp={onFinishDrag} onPointerCancel={onFinishDrag} onLostPointerCapture={onFinishDrag}>
        <button type="button" className="node-workspace-group-toggle" aria-expanded={!group.collapsed}
          aria-label={`${group.collapsed ? 'Expand' : 'Collapse'} ${group.label} group`}
          onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); if (event.detail > 0) event.currentTarget.blur(); onToggle?.(group.id); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={group.collapsed ? 'M9 5l7 7-7 7' : 'M5 9l7 7 7-7'} /></svg>
        </button>
        <span className="node-workspace-group-title">{group.label}</span>
        {group.issue ? <span className="node-workspace-group-warning" role="status" aria-label={`${group.label} paused: ${group.issue}`}
          title={`Paused: ${group.issue}`}>!</span> : <span className="node-workspace-group-count">{group.collapsed ? '' : members.length}</span>}
        {onToggleLock && <button type="button" className="node-workspace-group-toggle" aria-pressed={locks?.[group.id]?.locked !== false}
          aria-label={`${locks?.[group.id]?.locked === false ? 'Lock' : 'Unlock'} ${group.label} group`}
          title={locks?.[group.id]?.locked === false ? 'Lock group membership' : 'Unlock to move nodes between groups'}
          onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); if (event.detail > 0) event.currentTarget.blur(); onToggleLock(group.id); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" />
            <path d={locks?.[group.id]?.locked === false ? 'M8 10V6a4 4 0 0 1 8 0' : 'M8 10V6a4 4 0 0 1 8 0v4'} /></svg>
        </button>}
        {group.bypassNodeId && onToggleNodeBypass && <button type="button" className="node-workspace-group-focus"
          aria-label={`Bypass ${group.label} group`} aria-pressed={nodes.find(node => node.id === group.bypassNodeId)?.params?.enabled === false}
          onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); if (event.detail > 0) event.currentTarget.blur(); onToggleNodeBypass(group.bypassNodeId!); }}>Byp</button>}
        <button type="button" className="node-workspace-group-focus" aria-label={`Focus ${group.label} group`}
          onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); if (event.detail > 0) event.currentTarget.blur(); onFocus?.(group.id); }}>Focus</button>
      </div>
    </section>;
  })}</>;
});
