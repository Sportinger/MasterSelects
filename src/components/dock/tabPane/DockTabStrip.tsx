import type { RefObject } from 'react';

import type { DockDragState, DockPanel, DockTabGroup, HoveredDockTabTarget } from '../../../types/dock';
import { WIP_PANEL_TYPES } from '../../../types/dock';
import type { AudioMixerTabStats, DynamicTabTitleInput } from './layoutMath';
import { getDynamicTabTitle, getTimelineTabBarStyle } from './layoutMath';
import type { HoldProgress } from './useDockTabHoldDrag';

interface CompositionTab {
  id: string;
  name: string;
}

interface CompositionTabHandlers {
  onDragStart: (event: React.DragEvent, index: number) => void;
  onDragOver: (event: React.DragEvent, index: number) => void;
  onDragLeave: () => void;
  onDrop: (event: React.DragEvent, index: number) => void;
  onDragEnd: () => void;
}

interface DockTabStripProps {
  group: DockTabGroup;
  tabBarRef: RefObject<HTMLDivElement | null>;
  isMiddleDragging: boolean;
  groupContainsMaximizedPanel: boolean;
  hasTimelinePanel: boolean;
  timelinePanel: DockPanel | null;
  openCompositions: CompositionTab[];
  slotGridProgress: number;
  holdingTabId: string | null;
  holdProgress: HoldProgress;
  draggedCompIndex: number | null;
  dropTargetIndex: number | null;
  activeCompositionId: string | null;
  hoveredTabTarget: HoveredDockTabTarget | null;
  hoveredPanelId: string | null;
  maximizedPanelId: string | null;
  dragState: DockDragState;
  selectedSlotName: string | null;
  selectedPropertiesName: string | null;
  audioMixerTabStats: AudioMixerTabStats;
  addMenuOpen: boolean;
  onTabBarMouseDown: (event: React.MouseEvent) => void;
  onTabBarContextMenu: (event: React.MouseEvent) => void;
  onTimelineHandleMouseDown: (event: React.MouseEvent) => void;
  onTimelineHandleMouseUp: () => void;
  onTimelineHandleMouseLeave: () => void;
  onCompositionClick: (compositionId: string) => void;
  onCompositionClose: (compositionId: string, event: React.MouseEvent) => void;
  onCompositionTabMouseEnter: (compositionId: string) => void;
  onCompositionTabMouseLeave: () => void;
  compositionTabHandlers: CompositionTabHandlers;
  onTabClick: (index: number) => void;
  onTabMouseDown: (event: React.MouseEvent, panel: DockPanel, index: number) => void;
  onTabContextMenu: (event: React.MouseEvent, panel: DockPanel, index: number) => void;
  onTabMouseUp: () => void;
  onPanelTabMouseEnter: (panel: DockPanel) => void;
  onPanelTabMouseLeave: (panelId: string) => void;
  onAddButtonClick: (event: React.MouseEvent) => void;
}

const getHoldClasses = (
  tabId: string,
  holdingTabId: string | null,
  holdProgress: HoldProgress,
) => ({
  isHolding: holdingTabId === tabId && holdProgress === 'holding',
  isReady: holdingTabId === tabId && holdProgress === 'ready',
  isFading: holdingTabId === tabId && holdProgress === 'fading',
});

const getPanelTabTitle = (
  input: DynamicTabTitleInput,
): { tabTitle: string; tabTooltip: string } => getDynamicTabTitle(input);

export function DockTabStrip({
  group,
  tabBarRef,
  isMiddleDragging,
  groupContainsMaximizedPanel,
  hasTimelinePanel,
  timelinePanel,
  openCompositions,
  slotGridProgress,
  holdingTabId,
  holdProgress,
  draggedCompIndex,
  dropTargetIndex,
  activeCompositionId,
  hoveredTabTarget,
  hoveredPanelId,
  maximizedPanelId,
  dragState,
  selectedSlotName,
  selectedPropertiesName,
  audioMixerTabStats,
  addMenuOpen,
  onTabBarMouseDown,
  onTabBarContextMenu,
  onTimelineHandleMouseDown,
  onTimelineHandleMouseUp,
  onTimelineHandleMouseLeave,
  onCompositionClick,
  onCompositionClose,
  onCompositionTabMouseEnter,
  onCompositionTabMouseLeave,
  compositionTabHandlers,
  onTabClick,
  onTabMouseDown,
  onTabContextMenu,
  onTabMouseUp,
  onPanelTabMouseEnter,
  onPanelTabMouseLeave,
  onAddButtonClick,
}: DockTabStripProps) {
  const showCompositionTabs = hasTimelinePanel && openCompositions.length > 0 && slotGridProgress < 1;
  const handleHoldClasses = getHoldClasses('timeline-handle', holdingTabId, holdProgress);

  return (
    <div
      ref={tabBarRef}
      className={`dock-tab-bar ${isMiddleDragging ? 'middle-dragging' : ''} ${groupContainsMaximizedPanel ? 'is-maximized-bar' : ''}`}
      title="Ctrl+Scroll to zoom | Hold to drag | Middle-click drag to scroll"
      onMouseDown={onTabBarMouseDown}
      onContextMenu={onTabBarContextMenu}
      style={getTimelineTabBarStyle(hasTimelinePanel, openCompositions.length, slotGridProgress)}
    >
      {showCompositionTabs ? (
        <>
          {timelinePanel && (
            <div
              className={`dock-tab-handle ${handleHoldClasses.isHolding ? 'hold-glow' : ''} ${handleHoldClasses.isReady ? 'hold-ready' : ''} ${handleHoldClasses.isFading ? 'hold-fade' : ''}`}
              title="Hold to reposition panel"
              onMouseDown={onTimelineHandleMouseDown}
              onMouseUp={onTimelineHandleMouseUp}
              onMouseLeave={onTimelineHandleMouseLeave}
            >
              &#8942;&#8942;
            </div>
          )}
          {openCompositions.map((comp, index) => (
            <div
              key={comp.id}
              className={`dock-tab ${comp.id === activeCompositionId ? 'active' : ''} ${
                draggedCompIndex === index ? 'dragging' : ''
              } ${dropTargetIndex === index ? 'drop-target-tab' : ''} ${
                hoveredTabTarget?.kind === 'timeline-composition' && hoveredTabTarget.compositionId === comp.id ? 'shortcut-hover' : ''
              } ${maximizedPanelId === timelinePanel?.id && comp.id === activeCompositionId ? 'maximized-target' : ''}`}
              onClick={() => onCompositionClick(comp.id)}
              title={comp.name}
              onMouseEnter={() => onCompositionTabMouseEnter(comp.id)}
              onMouseLeave={onCompositionTabMouseLeave}
              draggable
              onDragStart={(event) => compositionTabHandlers.onDragStart(event, index)}
              onDragOver={(event) => compositionTabHandlers.onDragOver(event, index)}
              onDragLeave={compositionTabHandlers.onDragLeave}
              onDrop={(event) => compositionTabHandlers.onDrop(event, index)}
              onDragEnd={compositionTabHandlers.onDragEnd}
            >
              <span className="dock-tab-title">{comp.name}</span>
              <button
                className="dock-tab-close"
                onClick={(event) => onCompositionClose(comp.id, event)}
                title="Close"
              >
                &times;
              </button>
            </div>
          ))}
        </>
      ) : (
        group.panels.map((panel, index) => {
          const holdClasses = getHoldClasses(panel.id, holdingTabId, holdProgress);
          const isDragging = dragState.isDragging && dragState.draggedPanel?.id === panel.id;
          const { tabTitle, tabTooltip } = getPanelTabTitle({
            panel,
            selectedSlotName,
            selectedPropertiesName,
            audioMixerTabStats,
          });

          return (
            <div
              key={panel.id}
              className={`dock-tab ${index === group.activeIndex ? 'active' : ''} ${
                isDragging ? 'dragging' : ''
              } ${holdClasses.isHolding ? 'hold-glow' : ''} ${holdClasses.isReady ? 'hold-ready' : ''} ${holdClasses.isFading ? 'hold-fade' : ''} ${
                hoveredPanelId === panel.id ? 'shortcut-hover' : ''
              } ${maximizedPanelId === panel.id ? 'maximized-target' : ''}`}
              onClick={() => onTabClick(index)}
              onMouseDown={(event) => onTabMouseDown(event, panel, index)}
              onContextMenu={(event) => onTabContextMenu(event, panel, index)}
              onMouseUp={onTabMouseUp}
              onMouseEnter={() => onPanelTabMouseEnter(panel)}
              onMouseLeave={() => onPanelTabMouseLeave(panel.id)}
              title={tabTooltip}
              data-guided-panel-tab={panel.type}
              data-guided-target={`panel-tab:${panel.type}`}
              data-dock-layout-anim-id={`panel:${panel.id}`}
              data-dock-layout-anim-title={panel.title}
            >
              <span className="dock-tab-title">
                {tabTitle}
                {WIP_PANEL_TYPES.includes(panel.type) && <span className="menu-wip-badge">{'\uD83D\uDC1B'}</span>}
              </span>
            </div>
          );
        })
      )}
      <button
        className={`dock-tab-add ${addMenuOpen ? 'is-open' : ''}`}
        type="button"
        title="Add panel"
        aria-label="Add panel"
        onClick={onAddButtonClick}
        onMouseDown={(event) => event.stopPropagation()}
      >
        +
      </button>
    </div>
  );
}
