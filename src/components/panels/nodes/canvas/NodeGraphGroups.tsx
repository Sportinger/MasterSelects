import './NodeGraphGroups.css';
import { memo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import type { NodeGraph, NodeGraphNode, NodeGroupSize } from '../../../../types/nodeGraph';
import { nodeGroupBounds } from './groupBounds';
import { groupHeaderMetrics } from './groupHeaderMetrics';
import { NODE_WIDTH, type NodeBounds } from './canvasGeometry';
import { EMPTY_EFFECT_MIN_SIZE, resizeEmptyEffect } from '../../../../services/operators/imageNodeGraphEffect';

type Group = NonNullable<NodeGraph['groups']>[number];
const clampSize = (size: NodeGroupSize): NodeGroupSize => ({
  width: Math.max(EMPTY_EFFECT_MIN_SIZE.width, Math.round(size.width)), height: Math.max(EMPTY_EFFECT_MIN_SIZE.height, Math.round(size.height)) });

interface Props {
  graph: NodeGraph; nodes: NodeGraphNode[]; zoom?: number;
  frameNodes?: NodeGraphNode[];
  groupBounds?: ReadonlyMap<string, NodeBounds>;
  onToggle?: (id: string) => void; onFocus?: (id: string) => void; onToggleNodeBypass?: (id: string) => void;
  locks?: Record<string, { locked?: boolean }>; onToggleLock?: (id: string) => void;
  onStartDrag?: (event: PointerEvent<HTMLDivElement>, id: string) => void;
  onPointerMove?: (event: PointerEvent<HTMLDivElement>) => void;
  onFinishDrag?: (event: PointerEvent<HTMLDivElement>) => void;
}

export const NodeGraphGroups = memo(function NodeGraphGroups({ graph, nodes, zoom = 1, onToggle, onFocus, onToggleNodeBypass,
  onStartDrag, onPointerMove, onFinishDrag, locks, onToggleLock, frameNodes, groupBounds }: Props) {
  const bounds = groupBounds ?? nodeGroupBounds(graph, frameNodes ?? nodes), header = groupHeaderMetrics(zoom);
  const nodesById = new Map(nodes.map(node => [node.id, node]));
  const [draft, setDraft] = useState<{ id: string } & NodeGroupSize | null>(null);
  const resizeDrag = useRef<{ id: string; pointerId: number; x: number; y: number } & NodeGroupSize | null>(null);
  // The output card follows the new right edge, so an empty effect keeps input left and output right.
  const commitResize = (group: Group, box: NodeBounds, size: NodeGroupSize) => {
    const next = clampSize(size);
    const output = group.nodeIds.map(id => nodesById.get(id)).find(node => node?.operatorId === 'image.output');
    resizeEmptyEffect(graph.owner.id, group.id, next, output ? { graphId: graph.id, nodeId: output.id,
      layout: { x: box.left + next.width - 22 - NODE_WIDTH, y: output.layout.y } } : undefined);
  };
  return <>{graph.groups?.map(group => {
    if (group.collapsed) return null;
    const saved = bounds.get(group.id);
    if (!saved) return null;
    const box = draft?.id === group.id ? { ...saved, right: saved.left + draft.width, bottom: saved.top + draft.height } : saved;
    const current = { width: box.right - box.left, height: box.bottom - box.top };
    const resizeKey = (event: KeyboardEvent<HTMLButtonElement>) => {
      const step = event.shiftKey ? 80 : 20;
      const delta = { ArrowRight: [step, 0], ArrowLeft: [-step, 0], ArrowDown: [0, step], ArrowUp: [0, -step] }[event.key];
      if (!delta) return;
      event.preventDefault(); event.stopPropagation();
      commitResize(group, box, { width: current.width + delta[0], height: current.height + delta[1] });
    };
    const count = new Set(group.nodeIds.filter(id => nodesById.has(id))).size;
    const bypassed = group.bypassed ?? (nodesById.get(group.bypassNodeId ?? '')?.params?.enabled === false);
    return <section key={group.id} aria-label={`${group.label} node group`} className="node-workspace-group" data-group-id={group.id} data-bypassed={bypassed}
      style={{ left: box.left, top: box.top, width: box.right - box.left, height: box.bottom - box.top, '--group-color': group.color,
        '--group-header-height': `${header.height}px`, '--group-font-size': `${header.fontSize}px`, '--group-icon-size': `${header.iconSize}px`,
        '--group-control-size': `${header.controlSize}px`, '--group-gap': `${header.gap}px`, '--group-padding': `${header.padding}px`,
        '--group-focus-width': `${2 / zoom}px`, '--group-grip-size': `${16 / zoom}px` } as CSSProperties}>
      <div className="node-workspace-group-header" title={`Drag to move ${group.label} group`} data-compact={(box.right - box.left) * zoom < 250}
        onPointerDown={event => onStartDrag?.(event, group.id)} onPointerMove={onPointerMove}
        onPointerUp={onFinishDrag} onPointerCancel={onFinishDrag} onLostPointerCapture={onFinishDrag}>
        <GroupControls group={group} count={count} bypassed={bypassed} locked={locks?.[group.id]?.locked !== false}
          onToggle={onToggle} onFocus={onFocus} onToggleLock={onToggleLock} onToggleNodeBypass={onToggleNodeBypass} />
      </div>
      {group.resizable && <button type="button" className="node-workspace-group-resize" aria-label={`Resize ${group.label}`}
        title="Drag to resize this empty effect (arrow keys with focus)"
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault(); event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          resizeDrag.current = { id: group.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY, ...current };
          setDraft({ id: group.id, ...current });
        }}
        onPointerMove={event => {
          const drag = resizeDrag.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          event.stopPropagation();
          setDraft({ id: drag.id, ...clampSize({ width: drag.width + (event.clientX - drag.x) / zoom, height: drag.height + (event.clientY - drag.y) / zoom }) });
        }}
        onPointerUp={event => {
          const drag = resizeDrag.current;
          if (!drag || drag.pointerId !== event.pointerId) return;
          event.stopPropagation(); resizeDrag.current = null; event.currentTarget.blur();
          commitResize(group, saved, clampSize({ width: drag.width + (event.clientX - drag.x) / zoom, height: drag.height + (event.clientY - drag.y) / zoom }));
          setDraft(null);
        }}
        onPointerCancel={() => { resizeDrag.current = null; setDraft(null); }}
        onKeyDown={resizeKey} onClick={event => event.stopPropagation()}>
        <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M11 5L5 11M11 9L9 11" /></svg>
      </button>}
    </section>;
  })}</>;
});

/** Geometry changes each frame; labels and buttons change only at fold steps. */
const GroupControls = memo(function GroupControls({ group, count, bypassed, locked, onToggle, onFocus, onToggleLock, onToggleNodeBypass }:
  Pick<Props, 'onToggle' | 'onFocus' | 'onToggleLock' | 'onToggleNodeBypass'> & {
    group: NonNullable<NodeGraph['groups']>[number]; count: number; bypassed: boolean; locked: boolean;
  }) {
  return <>
        <button type="button" className="node-workspace-group-toggle" aria-expanded={!group.collapsed}
          aria-label={`${group.collapsed ? 'Expand' : 'Collapse'} ${group.label} group`}
          onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); if (event.detail > 0) event.currentTarget.blur(); onToggle?.(group.id); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d={group.collapsed ? 'M9 5l7 7-7 7' : 'M5 9l7 7 7-7'} /></svg>
        </button>
        <span className="node-workspace-group-title">{group.label}</span>
        {bypassed && <span className="node-workspace-group-status">Bypassed</span>}
        {group.issue ? <span className="node-workspace-group-warning" role="status" aria-label={`${group.label} paused: ${group.issue}`}
          title={`Paused: ${group.issue}`}>!</span> : <span className="node-workspace-group-count">{group.collapsed ? '' : count}</span>}
        {onToggleLock && <button type="button" className="node-workspace-group-toggle" aria-pressed={locked}
          aria-label={`${!locked ? 'Lock' : 'Unlock'} ${group.label} group`}
          title={!locked ? 'Lock group membership' : 'Unlock to move nodes between groups'}
          onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); if (event.detail > 0) event.currentTarget.blur(); onToggleLock(group.id); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2" />
            <path d={!locked ? 'M8 10V6a4 4 0 0 1 8 0' : 'M8 10V6a4 4 0 0 1 8 0v4'} /></svg>
        </button>}
        {group.bypassNodeId && onToggleNodeBypass && <button type="button" className="node-workspace-group-focus"
          aria-label={`Bypass ${group.label} group`} aria-pressed={bypassed}
          title={bypassed ? 'Enable group' : 'Bypass group'}
          onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); if (event.detail > 0) event.currentTarget.blur(); onToggleNodeBypass(group.bypassNodeId!); }}>Byp</button>}
        <button type="button" className="node-workspace-group-focus" aria-label={`Focus ${group.label} group`}
          onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}
          onClick={event => { event.stopPropagation(); if (event.detail > 0) event.currentTarget.blur(); onFocus?.(group.id); }}>Focus</button>
  </>;
});
