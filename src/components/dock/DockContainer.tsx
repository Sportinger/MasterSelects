// Root dock container - wraps docked panels and renders floating panels

import { useRef } from 'react';

import { useDockStore } from '../../stores/dockStore';
import { DockNode } from './DockNode';
import { DetachedPanelWindow } from './DetachedPanelWindow';
import { FloatingPanel } from './FloatingPanel';
import { DockDragPreview } from './container/DockDragPreview';
import { DockRootEdgeDropOverlay } from './container/DockRootEdgeDropOverlay';
import { useDockContainerGlobalDrag } from './container/useDockContainerGlobalDrag';
import { useDockLayoutTransition } from './container/useDockLayoutTransition';
import { useDockMaximizeAnimation } from './container/useDockMaximizeAnimation';
import { useRootEdgeDropTarget } from './container/useRootEdgeDropTarget';
import './dock.css';

export function DockContainer() {
  const containerRef = useRef<HTMLDivElement>(null);
  const {
    layout,
    browserWindowPanels,
    dragState,
    endDrag,
    cancelDrag,
    updateDrag,
    toggleHoveredTabMaximized,
    maximizedPanelId,
  } = useDockStore();
  const getRootEdgeDropTarget = useRootEdgeDropTarget({
    containerRef,
    rootGroupId: layout.root.id,
  });
  const rootEdgeDropPosition = dragState.dropTarget?.scope === 'root-edge'
    ? dragState.dropTarget.position
    : null;

  useDockMaximizeAnimation({
    containerRef,
    maximizedPanelId,
  });
  useDockLayoutTransition({
    containerRef,
    layout,
  });
  useDockContainerGlobalDrag({
    dragState,
    endDrag,
    cancelDrag,
    updateDrag,
    toggleHoveredTabMaximized,
    getRootEdgeDropTarget,
  });

  return (
    <div
      ref={containerRef}
      className={`dock-container ${dragState.isDragging ? 'dragging' : ''} ${maximizedPanelId ? 'is-panel-maximized' : ''}`}
    >
      <div className="dock-root">
        <DockNode node={layout.root} />
      </div>

      <DockRootEdgeDropOverlay
        isDragging={dragState.isDragging}
        position={rootEdgeDropPosition}
      />

      {layout.floatingPanels.map((floating) => (
        <FloatingPanel key={floating.id} floating={floating} />
      ))}

      {browserWindowPanels.map((windowPanel) => (
        <DetachedPanelWindow key={windowPanel.id} windowPanel={windowPanel} />
      ))}

      <DockDragPreview dragState={dragState} />
    </div>
  );
}
