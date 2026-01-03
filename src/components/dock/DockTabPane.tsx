// Tab group container with tab bar and panel content

import { useCallback, useRef } from 'react';
import type { DockTabGroup, DockPanel, DropPosition } from '../../types/dock';
import { useDockStore } from '../../stores/dockStore';
import { DockPanelContent } from './DockPanelContent';
import { calculateDropPosition } from '../../utils/dockLayout';

interface DockTabPaneProps {
  group: DockTabGroup;
}

export function DockTabPane({ group }: DockTabPaneProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { setActiveTab, startDrag, updateDrag, dragState } = useDockStore();

  const activePanel = group.panels[group.activeIndex];
  const isDropTarget = dragState.dropTarget?.groupId === group.id;
  const dropPosition = dragState.dropTarget?.position;

  const handleTabClick = useCallback((index: number) => {
    setActiveTab(group.id, index);
  }, [group.id, setActiveTab]);

  const handleTabMouseDown = useCallback((e: React.MouseEvent, panel: DockPanel, index: number) => {
    if (e.button !== 0) return;

    // Set this tab as active
    setActiveTab(group.id, index);

    // Start drag after small delay to distinguish from click
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    startDrag(panel, group.id, {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  }, [group.id, setActiveTab, startDrag]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState.isDragging || !containerRef.current) return;
    if (dragState.sourceGroupId === group.id && group.panels.length === 1) return;

    const rect = containerRef.current.getBoundingClientRect();
    const position = calculateDropPosition(rect, e.clientX, e.clientY);

    updateDrag(
      { x: e.clientX, y: e.clientY },
      { groupId: group.id, position }
    );
  }, [dragState.isDragging, dragState.sourceGroupId, group.id, group.panels.length, updateDrag]);

  const handleMouseLeave = useCallback(() => {
    if (dragState.isDragging && dragState.dropTarget?.groupId === group.id) {
      updateDrag(dragState.currentPos, null);
    }
  }, [dragState, group.id, updateDrag]);

  return (
    <div
      ref={containerRef}
      className={`dock-tab-pane ${isDropTarget ? 'drop-target' : ''}`}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      {/* Tab bar */}
      <div className="dock-tab-bar">
        {group.panels.map((panel, index) => (
          <div
            key={panel.id}
            className={`dock-tab ${index === group.activeIndex ? 'active' : ''} ${
              dragState.isDragging && dragState.draggedPanel?.id === panel.id ? 'dragging' : ''
            }`}
            onClick={() => handleTabClick(index)}
            onMouseDown={(e) => handleTabMouseDown(e, panel, index)}
          >
            <span className="dock-tab-title">{panel.title}</span>
          </div>
        ))}
      </div>

      {/* Panel content */}
      <div className="dock-panel-content">
        {activePanel && <DockPanelContent type={activePanel.type} />}
      </div>

      {/* Drop zone overlay */}
      {isDropTarget && dropPosition && (
        <div className={`dock-drop-overlay ${dropPosition}`} />
      )}
    </div>
  );
}
