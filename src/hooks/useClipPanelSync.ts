// Hook to auto-switch panels based on selected clip
// Activates Properties panel when any clip is selected

import { useEffect, useRef } from 'react';
import { useTimelineStore } from '../stores/timeline';
import type { TimelineState } from '../stores/timeline/types';
import { FACTORY_COLOR_LAYOUT_ID, useDockStore } from '../stores/dockStore';
import { nodeContainsPanelType } from '../stores/dockStore/layoutTree';
import { isExclusiveTimelineMutationLeaseActive } from '../stores/timeline/exclusiveMutationLease';

type PanelSyncState = Pick<TimelineState, 'clips' | 'tracks' | 'selectedClipIds' | 'propertiesSelection'>;

/** The inspected target, or null when it does not exist (yet). A string, so it compares by value. */
export function selectPanelSyncSelectionKey(state: PanelSyncState): string | null {
  const { propertiesSelection, selectedClipIds } = state;
  if (propertiesSelection?.kind === 'clip') {
    return state.clips.some(clip => clip.id === propertiesSelection.clipId)
      ? `clip:${propertiesSelection.clipId}`
      : null;
  }
  if (propertiesSelection?.kind === 'track') {
    return state.tracks.some(track => track.id === propertiesSelection.trackId)
      ? `track:${propertiesSelection.trackId}`
      : null;
  }
  if (propertiesSelection?.kind === 'master') return 'master';
  const selectedId = selectedClipIds.size > 0 ? selectedClipIds.values().next().value : null;
  return selectedId && state.clips.some(clip => clip.id === selectedId) ? `clip:${selectedId}` : null;
}

export function useClipPanelSync() {
  // The key reads clips and tracks inside the selector: subscribing to the whole clips array
  // re-rendered App on every inspector drag sample, although only existence matters here.
  const selectionKey = useTimelineStore(selectPanelSyncSelectionKey);
  const selectedClipIds = useTimelineStore(state => state.selectedClipIds);
  const propertiesSelection = useTimelineStore(state => state.propertiesSelection);
  const activatePanelType = useDockStore(state => state.activatePanelType);
  const activeSavedLayoutId = useDockStore(state => state.activeSavedLayoutId);
  const colorWorkspaceVisible = useDockStore(state => (
    nodeContainsPanelType(state.layout.root, 'color-nodes')
    || state.layout.floatingPanels.some(floating => floating.panel.type === 'color-nodes')
    || state.browserWindowPanels.some(windowPanel => windowPanel.panel.type === 'color-nodes')
  ));

  // Track selection action objects, not just the selected ID. Clicking an
  // already-selected clip creates a fresh selection and must bring Properties
  // back in front of Export without resetting the active Properties sub-tab.
  const prevSelectionRefs = useRef<{
    propertiesSelection: typeof propertiesSelection;
    selectedClipIds: typeof selectedClipIds;
  } | null>(null);

  useEffect(() => {
    const previousRefs = prevSelectionRefs.current;
    const selectionActionOccurred = previousRefs === null
      || previousRefs.propertiesSelection !== propertiesSelection
      || previousRefs.selectedClipIds !== selectedClipIds;
    prevSelectionRefs.current = { propertiesSelection, selectedClipIds };

    // Clip/track data updates alone must not steal focus from another panel.
    if (!selectionKey || !selectionActionOccurred) {
      return;
    }

    // Agent selections update the inspector target without taking over the dock.
    // Keep this intent on the selection: an AI call can finish before this effect runs.
    if (propertiesSelection?.kind === 'clip' && propertiesSelection.revealPanel === false) return;

    // The dedicated Color workspace owns its panel arrangement. Selecting a
    // clip there updates the grading target without replacing the workspace
    // with the generic Properties panel.
    if (activeSavedLayoutId === FACTORY_COLOR_LAYOUT_ID || colorWorkspaceVisible) return;

    // Kernel transactions keep every history-backed store locked until the
    // verified edit commits. Selection changes render before that commit, so
    // focusing a dock tab from this passive effect would be an unauthorized
    // history mutation and would surface as an uncaught React error.
    if (isExclusiveTimelineMutationLeaseActive()) return;

    // Activate Properties panel for clip, audio track, and master bus targets.
    activatePanelType('clip-properties');
  }, [
    selectedClipIds,
    propertiesSelection,
    selectionKey,
    activatePanelType,
    activeSavedLayoutId,
    colorWorkspaceVisible,
  ]);
}
