// Preview top toolbar: source selector, edit mode toggle, zoom controls

import React from 'react';
import type { Composition } from '../../stores/mediaStore/types';
import type { TimelineTrack } from '../../types';
import type { PreviewPanelSource } from '../../types/dock';
import {
  getCompositionVideoTracks,
  getPreviewLayerLabel,
  isSamePreviewPanelSource,
} from '../../utils/previewPanelSource';

interface PreviewControlsProps {
  // Source monitor
  sourceMonitorActive: boolean;
  sourceMonitorFileName: string | null;
  closeSourceMonitor: () => void;
  // Edit mode
  editMode: boolean;
  canEdit: boolean;
  setEditMode: (v: boolean) => void;
  viewZoom: number;
  resetView: () => void;
  // Source selector
  source: PreviewPanelSource;
  sourceLabel: string;
  activeCompositionId: string | null;
  activeCompositionVideoTracks: TimelineTrack[];
  selectorOpen: boolean;
  setSelectorOpen: (v: boolean) => void;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  dropdownStyle: React.CSSProperties;
  compositions: Composition[];
  setPanelSource: (source: PreviewPanelSource) => void;
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
  canEdit,
  setEditMode,
  viewZoom,
  resetView,
  source,
  sourceLabel,
  activeCompositionId,
  activeCompositionVideoTracks,
  selectorOpen,
  setSelectorOpen,
  dropdownRef,
  dropdownStyle,
  compositions,
  setPanelSource,
  panelId,
  addPreviewPanel,
  closePanelById,
}: PreviewControlsProps) {
  const renderLayerOptions = (compositionId: string | null) => {
    const videoTracks = getCompositionVideoTracks(
      compositionId,
      compositions,
      activeCompositionId,
      activeCompositionVideoTracks,
    );

    return videoTracks.map((track, layerIndex) => {
      const layerSource: PreviewPanelSource = {
        type: 'layer-index',
        compositionId,
        layerIndex,
      };

      return (
        <button
          key={`${compositionId ?? 'active'}-layer-${layerIndex}`}
          className={`preview-comp-option layer-option ${isSamePreviewPanelSource(source, layerSource) ? 'active' : ''}`}
          onClick={() => {
            setPanelSource(layerSource);
            setSelectorOpen(false);
          }}
        >
          {getPreviewLayerLabel(layerIndex, track.name)}
        </button>
      );
    });
  };

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
            x
          </button>
        </>
      ) : (
        <>
          <button
            className={`preview-edit-btn ${editMode ? 'active' : ''}`}
            onClick={() => canEdit && setEditMode(!editMode)}
            title={canEdit ? 'Toggle Edit Mode [Tab]' : 'Edit mode only works on the full active composition'}
            disabled={!canEdit}
          >
            {editMode ? 'Edit On' : 'Edit'} <span className="menu-wip-badge">bug</span>
          </button>
          {editMode && canEdit && (
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
              title="Select preview source"
            >
              <span className="preview-comp-name">{sourceLabel}</span>
              <span className="preview-comp-arrow">v</span>
            </button>
            {selectorOpen && (
              <div className="preview-comp-dropdown" ref={dropdownRef} style={dropdownStyle}>
                <div className="preview-comp-group-label">Dynamic</div>
                <button
                  className={`preview-comp-option ${source.type === 'activeComp' ? 'active' : ''}`}
                  onClick={() => {
                    setPanelSource({ type: 'activeComp' });
                    setSelectorOpen(false);
                  }}
                >
                  Active Composition
                </button>
                {renderLayerOptions(null)}
                <div className="preview-comp-separator" />
                <div className="preview-comp-group-label">Compositions</div>
                {compositions.map((comp) => (
                  <React.Fragment key={comp.id}>
                    <button
                      className={`preview-comp-option ${
                        source.type === 'composition' && source.compositionId === comp.id ? 'active' : ''
                      }`}
                      onClick={() => {
                        setPanelSource({ type: 'composition', compositionId: comp.id });
                        setSelectorOpen(false);
                      }}
                    >
                      {comp.name}
                    </button>
                    {renderLayerOptions(comp.id)}
                  </React.Fragment>
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
