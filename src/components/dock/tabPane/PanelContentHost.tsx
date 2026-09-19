import type { CSSProperties } from 'react';

import type { DockPanel } from '../../../types/dock';
import { DockPanelContent } from '../DockPanelContent';
import type {
  DockPanelTabSwipeHandlers,
  DockPanelTabSwipeMotion,
} from './useDockPanelTabSwipe';

interface PanelContentHostProps {
  activePanel: DockPanel | undefined;
  panelZoom: number;
  isActivePanelMaximized: boolean;
  onPaneMouseEnter: () => void;
  tabSwipeHandlers: DockPanelTabSwipeHandlers;
  tabSwipeMotionClass: DockPanelTabSwipeMotion;
  suppressTabSwipeContentInteractions: boolean;
}

export function PanelContentHost({
  activePanel,
  panelZoom,
  isActivePanelMaximized,
  onPaneMouseEnter,
  tabSwipeHandlers,
  tabSwipeMotionClass,
  suppressTabSwipeContentInteractions,
}: PanelContentHostProps) {
  return (
    <div
      className={`dock-panel-content ${isActivePanelMaximized ? 'is-maximized-content' : ''}`}
      style={{ '--panel-zoom': panelZoom } as CSSProperties}
      onMouseEnter={onPaneMouseEnter}
      data-guided-panel={activePanel?.type}
      data-panel-type={activePanel?.type}
      data-tab-swipe-claimed={suppressTabSwipeContentInteractions || undefined}
      data-tab-swipe-motion={tabSwipeMotionClass || undefined}
      {...tabSwipeHandlers}
    >
      <div
        key={activePanel?.id ?? 'empty-panel'}
        className={`dock-panel-content-inner ${activePanel ? `dock-panel-content-inner--${activePanel.type}` : ''} ${tabSwipeMotionClass}`}
      >
        {activePanel && <DockPanelContent panel={activePanel} allowPanelMaximize />}
      </div>
      {panelZoom !== 1.0 && (
        <div className="dock-zoom-indicator">
          {Math.round(panelZoom * 100)}%
        </div>
      )}
    </div>
  );
}
