import type { CSSProperties } from 'react';

import type { DockPanel } from '../../../types/dock';
import { DockPanelContent } from '../DockPanelContent';

interface PanelContentHostProps {
  activePanel: DockPanel | undefined;
  panelZoom: number;
  isActivePanelMaximized: boolean;
  onPaneMouseEnter: () => void;
}

export function PanelContentHost({
  activePanel,
  panelZoom,
  isActivePanelMaximized,
  onPaneMouseEnter,
}: PanelContentHostProps) {
  return (
    <div
      className={`dock-panel-content ${isActivePanelMaximized ? 'is-maximized-content' : ''}`}
      style={{ '--panel-zoom': panelZoom } as CSSProperties}
      onMouseEnter={onPaneMouseEnter}
      data-guided-panel={activePanel?.type}
      data-panel-type={activePanel?.type}
    >
      <div className={`dock-panel-content-inner ${activePanel ? `dock-panel-content-inner--${activePanel.type}` : ''}`}>
        {activePanel && <DockPanelContent panel={activePanel} />}
      </div>
      {panelZoom !== 1.0 && (
        <div className="dock-zoom-indicator">
          {Math.round(panelZoom * 100)}%
        </div>
      )}
    </div>
  );
}
