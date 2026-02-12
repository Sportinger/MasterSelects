// Preview top toolbar: composition selector, edit mode toggle, zoom controls

import React from 'react';
import type { Composition } from '../../stores/mediaStore/types';

interface PreviewControlsProps {
  // Source monitor
  sourceMonitorActive: boolean;
  sourceMonitorFileName: string | null;
  closeSourceMonitor: () => void;
  // Edit mode
  editMode: boolean;
  setEditMode: (v: boolean) => void;
  viewZoom: number;
  resetView: () => void;
  // Composition selector
  compositionId: string | null;
  displayedComp: Composition | undefined;
  selectorOpen: boolean;
  setSelectorOpen: (v: boolean) => void;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  dropdownStyle: React.CSSProperties;
  compositions: Composition[];
  updatePanelData: (panelId: string, data: Record<string, unknown>) => void;
  panelId: string;
  // Panel management
  addPreviewPanel: (compositionId: string | null) => void;
  closePanelById: (panelId: string) => void;
}

export function PreviewControls({
  sourceMonitorActive,
  sourceMonitorFileName,
  closeSourceMonitor,
  editMode,
  setEditMode,
  viewZoom,
  resetView,
  compositionId,
  displayedComp,
  selectorOpen,
  setSelectorOpen,
  dropdownRef,
  dropdownStyle,
  compositions,
  updatePanelData,
  panelId,
  addPreviewPanel,
  closePanelById,
}: PreviewControlsProps) {
  return (
    <div className="preview-controls">
      {sourceMonitorActive ? (
        <>
          <span className="preview-source-label" title={sourceMonitorFileName ?? undefined}>
            {sourceMonitorFileName}
          </span>
          <button
            className="preview-close-source-btn"
            onClick={closeSourceMonitor}
            title="Close source monitor [Esc]"
          >
            ✕
          </button>
        </>
      ) : (
        <>
          <button
            className={`preview-edit-btn ${editMode ? 'active' : ''}`}
            onClick={() => setEditMode(!editMode)}
            title="Toggle Edit Mode [Tab]"
          >
            {editMode ? '✓ Edit' : 'Edit'} <span className="menu-wip-badge">🐛</span>
          </button>
          {editMode && (
            <>
              <span className="preview-zoom-label">{Math.round(viewZoom * 100)}%</span>
              <button
                className="preview-reset-btn"
                onClick={resetView}
                title="Reset View"
              >
                Reset
              </button>
            </>
          )}
          <div className="preview-comp-dropdown-wrapper">
            <button
              className="preview-comp-dropdown-btn"
              onClick={() => setSelectorOpen(!selectorOpen)}
              title="Select composition to display"
            >
              <span className="preview-comp-name">
                {compositionId === null ? 'Active' : displayedComp?.name || 'Unknown'}
              </span>
              <span className="preview-comp-arrow">▼</span>
            </button>
            {selectorOpen && (
              <div className="preview-comp-dropdown" ref={dropdownRef} style={dropdownStyle}>
                <button
                  className={`preview-comp-option ${compositionId === null ? 'active' : ''}`}
                  onClick={() => {
                    updatePanelData(panelId, { compositionId: null });
                    setSelectorOpen(false);
                  }}
                >
                  Active Composition
                </button>
                <div className="preview-comp-separator" />
                {compositions.map((comp) => (
                  <button
                    key={comp.id}
                    className={`preview-comp-option ${compositionId === comp.id ? 'active' : ''}`}
                    onClick={() => {
                      updatePanelData(panelId, { compositionId: comp.id });
                      setSelectorOpen(false);
                    }}
                  >
                    {comp.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
      <button
        className="preview-add-btn"
        onClick={() => addPreviewPanel(null)}
        title="Add another preview panel"
      >
        +
      </button>
      <button
        className="preview-close-btn"
        onClick={() => closePanelById(panelId)}
        title="Close this preview panel"
      >
        -
      </button>
    </div>
  );
}
