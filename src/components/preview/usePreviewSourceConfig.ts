import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useShallow } from 'zustand/react/shallow';

import { useDockStore } from '../../stores/dockStore';
import { useMediaStore, type Composition, type MediaFile } from '../../stores/mediaStore';
import { useSettingsStore } from '../../stores/settingsStore';
import type { TimelineTrack } from '../../types/timeline';
import type { PreviewPanelSource } from '../../types/dock';
import {
  createPreviewPanelDataPatch,
  getPreviewSourceLabel,
  normalizeVisiblePreviewPanelSource,
  resolvePreviewSourceCompositionId,
} from '../../utils/previewPanelSource';
import { getFirstEditablePreviewPanelId } from './previewPanelDom';

interface UsePreviewSourceConfigOptions {
  panelId: string;
  source: PreviewPanelSource;
  showTransparencyGrid: boolean;
  tracks: TimelineTrack[];
}

export interface PreviewSourceConfig {
  activeCompositionId: string | null;
  activeCompositionVideoTracks: TimelineTrack[];
  closeSourceMonitor: () => void;
  compositions: Composition[];
  displayedCompId: string | null;
  effectiveResolution: { width: number; height: number };
  isEditableSource: boolean;
  renderSource: PreviewPanelSource;
  setPanelSource: (nextSource: PreviewPanelSource) => void;
  sourceLabel: string;
  sourceMonitorActive: boolean;
  sourceMonitorFile: MediaFile | null;
  sourceMonitorPlaybackRequestId: number;
  stableRenderSource: PreviewPanelSource;
  toggleTransparency: () => void;
}

export function usePreviewSourceConfig({
  panelId,
  source,
  showTransparencyGrid,
  tracks,
}: UsePreviewSourceConfigOptions): PreviewSourceConfig {
  const { compositions, activeCompositionId } = useMediaStore(useShallow(s => ({
    compositions: s.compositions,
    activeCompositionId: s.activeCompositionId,
  })));
  const { updatePanelData } = useDockStore(useShallow(s => ({
    updatePanelData: s.updatePanelData,
  })));
  const previewCompositionId = useMediaStore(state => state.previewCompositionId);
  const sourceMonitorFileId = useMediaStore(state => state.sourceMonitorFileId);
  const sourceMonitorPlaybackRequestId = useMediaStore(state => state.sourceMonitorPlaybackRequestId);
  const sourceMonitorFile = useMediaStore(state =>
    state.sourceMonitorFileId ? state.files.find(f => f.id === state.sourceMonitorFileId) ?? null : null
  );
  const previousActiveCompositionIdRef = useRef(activeCompositionId);

  const activeCompositionVideoTracks = useMemo(
    () => tracks.filter((track) => track.type === 'video'),
    [tracks],
  );
  const visibleSource = useMemo(
    () => normalizeVisiblePreviewPanelSource(source, compositions, activeCompositionId),
    [source, compositions, activeCompositionId],
  );
  const sourceLabel = useMemo(
    () => getPreviewSourceLabel(visibleSource, compositions, activeCompositionId, activeCompositionVideoTracks),
    [visibleSource, compositions, activeCompositionId, activeCompositionVideoTracks],
  );

  const sourceMonitorActive = source.type === 'activeComp'
    && sourceMonitorFile !== null
    && getFirstEditablePreviewPanelId() === panelId;

  const closeSourceMonitor = useCallback(() => {
    useMediaStore.getState().setSourceMonitorFile(null);
  }, []);

  useEffect(() => {
    const previousActiveCompositionId = previousActiveCompositionIdRef.current;
    if (previousActiveCompositionId !== activeCompositionId) {
      previousActiveCompositionIdRef.current = activeCompositionId;
      if (sourceMonitorFileId) {
        useMediaStore.getState().setSourceMonitorFile(null);
      }
    }
  }, [activeCompositionId, sourceMonitorFileId]);

  const slotPreviewActive = source.type === 'activeComp' && previewCompositionId !== null;
  const renderSource = useMemo<PreviewPanelSource>(
    () => normalizeVisiblePreviewPanelSource(
      slotPreviewActive && previewCompositionId
        ? { type: 'composition', compositionId: previewCompositionId }
        : source,
      compositions,
      activeCompositionId,
    ),
    [source, slotPreviewActive, previewCompositionId, compositions, activeCompositionId],
  );
  const renderSourceCompositionId =
    renderSource.type === 'composition' || renderSource.type === 'layer-index'
      ? renderSource.compositionId
      : null;
  const renderSourceLayerIndex =
    renderSource.type === 'layer-index'
      ? renderSource.layerIndex
      : null;
  const stableRenderSource = useMemo<PreviewPanelSource>(() => {
    switch (renderSource.type) {
      case 'activeComp':
        return { type: 'activeComp' };
      case 'composition':
        return { type: 'composition', compositionId: renderSourceCompositionId ?? activeCompositionId ?? '' };
      case 'layer-index':
        return {
          type: 'layer-index',
          compositionId: renderSourceCompositionId,
          layerIndex: renderSourceLayerIndex ?? 0,
        };
    }
  }, [activeCompositionId, renderSource.type, renderSourceCompositionId, renderSourceLayerIndex]);
  const displayedCompId = resolvePreviewSourceCompositionId(renderSource, activeCompositionId, compositions);
  const displayedComp = compositions.find(c => c.id === displayedCompId);
  const isEditableSource =
    renderSource.type === 'activeComp' ||
    (renderSource.type === 'composition' && renderSource.compositionId === activeCompositionId);
  const effectiveResolution = displayedComp
    ? { width: displayedComp.width, height: displayedComp.height }
    : useSettingsStore.getState().outputResolution;

  const setPanelSource = useCallback(
    (nextSource: PreviewPanelSource) => {
      updatePanelData(panelId, createPreviewPanelDataPatch(nextSource, { showTransparencyGrid }));
    },
    [panelId, showTransparencyGrid, updatePanelData],
  );

  const toggleTransparency = useCallback(() => {
    updatePanelData(
      panelId,
      createPreviewPanelDataPatch(source, { showTransparencyGrid: !showTransparencyGrid }),
    );
  }, [panelId, showTransparencyGrid, source, updatePanelData]);

  return {
    activeCompositionId,
    activeCompositionVideoTracks,
    closeSourceMonitor,
    compositions,
    displayedCompId,
    effectiveResolution,
    isEditableSource,
    renderSource,
    setPanelSource,
    sourceLabel,
    sourceMonitorActive,
    sourceMonitorFile,
    sourceMonitorPlaybackRequestId,
    stableRenderSource,
    toggleTransparency,
  };
}
