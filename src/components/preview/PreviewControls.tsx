// Preview top toolbar: scene overlay, edit/source controls, and 3D tools

import React from 'react';
import './PreviewControls.css';
import type { Composition } from '../../stores/mediaStore/types';
import { isUserVisibleComposition } from '../../stores/mediaStore/compositionVisibility';
import type { TimelineTrack } from '../../types/timeline';
import type { PreviewPanelSource } from '../../types/dock';
import { PreviewCompositionSourceGroup } from './PreviewCompositionSourceGroup';
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
  showEditViewControls: boolean;
  sceneObjectOverlayEnabled: boolean;
  setSceneObjectOverlayEnabled: (v: boolean) => void;
  viewZoom: number;
  resetView: () => void;
  // Source selector
  source: PreviewPanelSource;
  sourceLabel: string;
  activeCompositionId: string | null;
  activeCompositionVideoTracks: TimelineTrack[];
  selectorOpen: boolean;
  setSelectorOpen: (v: boolean) => void;
  setSceneGizmoToolbarTarget: (target: HTMLDivElement | null) => void;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  dropdownStyle: React.CSSProperties;
  compositions: Composition[];
  setPanelSource: (source: PreviewPanelSource) => void;
}

export function PreviewControls({
  sourceMonitorActive,
  sourceMonitorFileName,
  closeSourceMonitor,
  editMode,
  canEdit,
  setEditMode,
  showEditViewControls,
  sceneObjectOverlayEnabled,
  setSceneObjectOverlayEnabled,
  viewZoom,
  resetView,
  source,
  sourceLabel,
  activeCompositionId,
  activeCompositionVideoTracks,
  selectorOpen,
  setSelectorOpen,
  setSceneGizmoToolbarTarget,
  dropdownRef,
  dropdownStyle,
  compositions,
  setPanelSource,
}: PreviewControlsProps) {
  const visibleCompositions = compositions.filter(isUserVisibleComposition);
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

  const renderSourceSelector = () => (
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
          <PreviewCompositionSourceGroup
            label="Active Composition"
            active={source.type === 'activeComp'}
            onSelect={() => {
              setPanelSource({ type: 'activeComp' });
              setSelectorOpen(false);
            }}
          >
            {renderLayerOptions(null)}
          </PreviewCompositionSourceGroup>
          <div className="preview-comp-separator" />
          <div className="preview-comp-group-label">Compositions</div>
          {visibleCompositions.map((comp) => (
            <PreviewCompositionSourceGroup
              key={comp.id}
              label={comp.name}
              active={source.type === 'composition' && source.compositionId === comp.id}
              onSelect={() => {
                setPanelSource({ type: 'composition', compositionId: comp.id });
                setSelectorOpen(false);
              }}
            >
              {renderLayerOptions(comp.id)}
            </PreviewCompositionSourceGroup>
          ))}
        </div>
      )}
    </div>
  );

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
          {canEdit && (
            <button
              type="button"
              className={`preview-scene-toggle-btn ${sceneObjectOverlayEnabled ? 'active' : ''}`}
              onClick={() => setSceneObjectOverlayEnabled(!sceneObjectOverlayEnabled)}
              title={sceneObjectOverlayEnabled ? 'Hide scene handles' : 'Show scene handles'}
              aria-label={sceneObjectOverlayEnabled ? 'Hide scene handles' : 'Show scene handles'}
              aria-pressed={sceneObjectOverlayEnabled}
            >
              <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M8 8h5" />
                <path d="M8 8V3" />
                <path d="M8 8l-3.5 3.5" />
                <circle cx="8" cy="8" r="1.7" fill="currentColor" stroke="none" />
              </svg>
            </button>
          )}
          {sceneObjectOverlayEnabled && (
            <>
              <button
                className={`preview-edit-btn ${editMode ? 'active' : ''}`}
                onClick={() => canEdit && setEditMode(!editMode)}
                title={canEdit ? 'Toggle Edit Mode [Tab]' : 'Edit mode only works on the full active composition'}
                disabled={!canEdit}
              >
                Edit
              </button>
              {renderSourceSelector()}
              <div
                ref={setSceneGizmoToolbarTarget}
                className="preview-scene-gizmo-toolbar-slot"
              />
              {showEditViewControls && canEdit && (
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
            </>
          )}
        </>
      )}
    </div>
  );
}
