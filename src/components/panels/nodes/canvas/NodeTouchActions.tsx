import type { RefObject } from 'react';
import type { NodeGraphLayout } from '../../../../types/nodeGraph';
import type { NodeGraphPoint } from './canvasGeometry';
import './NodeTouchActions.css';

/**
 * Toolbar actions for touch screens, where the mouse paths (right-click add menu, Delete key) are out of
 * reach: "Add" opens the same add menu as a right-click, at the middle of the canvas and aimed at the
 * selected node; "Delete" removes the selection like the Delete key. CSS shows them only for a coarse
 * primary pointer or inside the phone skin, so mouse layouts are unchanged.
 */
export function NodeTouchActions({ canvasRef, getGraphPoint, selectedNodeId, selectionSize, onOpenAddMenu, onDelete }: {
  canvasRef: RefObject<HTMLDivElement | null>;
  getGraphPoint: (clientX: number, clientY: number) => NodeGraphPoint;
  selectedNodeId: string | null;
  selectionSize: number;
  onOpenAddMenu?: (position: { x: number; y: number; layout: NodeGraphLayout; nodeId?: string | null; groupId?: string | null }) => void;
  onDelete?: () => void;
}) {
  const hasSelection = !!selectedNodeId || selectionSize > 0;
  return <>
    {onOpenAddMenu && <button type="button" className="node-workspace-toolbar-button node-workspace-touch-action" data-testid="node-touch-add"
      title="Add a node or effect" onClick={event => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const x = rect.left + rect.width / 2, y = rect.top + Math.min(rect.height / 2, 120);
        const point = getGraphPoint(x, y);
        onOpenAddMenu({ x, y, layout: { x: Math.round(point.x), y: Math.round(point.y) }, nodeId: selectedNodeId, groupId: null });
        event.currentTarget.blur();
      }}>Add</button>}
    {onDelete && <button type="button" className="node-workspace-toolbar-button node-workspace-touch-action" data-testid="node-touch-delete"
      title="Delete the selected nodes" disabled={!hasSelection} onClick={event => { onDelete(); event.currentTarget.blur(); }}>Delete</button>}
  </>;
}
