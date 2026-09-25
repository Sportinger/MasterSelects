import { memo, type PointerEvent as ReactPointerEvent } from 'react';
import type { NodeCableBranch } from '../../../../types/nodeGraph';
import type { NodeGraphPoint } from './canvasGeometry';
import { branchMetrics } from './cableBranches';
import './NodeGraphBranches.css';

interface Props {
  zoom: number;
  branches: ReadonlyMap<string, NodeCableBranch>;
  selected: ReadonlySet<string>;
  onStartMove: (event: ReactPointerEvent<HTMLElement>, id: string) => void;
  onMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onFinishMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onRemove: (ids: Iterable<string>) => void;
  onOpenMenu: (id: string, clientX: number, clientY: number) => void;
  onStartConnection: (event: ReactPointerEvent, branch: { id: string; nodeId: string; portId: string; point: NodeGraphPoint }) => void;
}

/** Invisible, focusable hit targets over the worker-painted branch points and their connection grips. */
export const NodeGraphBranchHandles = memo(function NodeGraphBranchHandles({ zoom, branches, selected, onStartMove, onMove, onFinishMove, onRemove, onOpenMenu, onStartConnection }: Props) {
  const { radius, grip } = branchMetrics(zoom);
  return <>{[...branches].map(([id, branch]) => <div key={id}>
    <div className="node-workspace-branch" role="button" tabIndex={0} aria-pressed={selected.has(id)}
      aria-label="Cable branch point. Drag to move, double-click or Delete to remove."
      style={{ left: branch.x - radius, top: branch.y - radius, width: radius * 2, height: radius * 2 }}
      onPointerDown={event => onStartMove(event, id)} onPointerMove={onMove} onPointerUp={onFinishMove} onPointerCancel={onFinishMove}
      onDoubleClick={event => { event.stopPropagation(); onRemove([id]); }}
      onContextMenu={event => { event.preventDefault(); event.stopPropagation(); onOpenMenu(id, event.clientX, event.clientY); }}
      onKeyDown={event => {
        if (event.key !== 'Delete' && event.key !== 'Backspace') return;
        event.preventDefault(); event.stopPropagation(); onRemove(selected.has(id) ? selected : [id]);
      }} />
    <div className="node-workspace-branch-grip" title="Drag to connect another input from this branch point"
      style={{ left: branch.x + radius, top: branch.y - radius, width: grip - radius + radius / 2, height: radius * 2 }}
      onPointerDown={event => { event.stopPropagation(); onStartConnection(event, { id, nodeId: branch.nodeId, portId: branch.portId, point: { x: branch.x, y: branch.y } }); }} />
  </div>)}</>;
});
