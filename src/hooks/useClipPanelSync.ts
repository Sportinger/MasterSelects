// Hook to auto-switch panels based on selected clip
// Activates Properties panel when any clip is selected

import { useEffect, useRef } from 'react';
import { useTimelineStore } from '../stores/timeline';
import { useDockStore } from '../stores/dockStore';

export function useClipPanelSync() {
  const clips = useTimelineStore(state => state.clips);
  const tracks = useTimelineStore(state => state.tracks);
  const selectedClipIds = useTimelineStore(state => state.selectedClipIds);
  const propertiesSelection = useTimelineStore(state => state.propertiesSelection);
  const activatePanelType = useDockStore(state => state.activatePanelType);

  // Track previous selection to only activate on new selections
  const prevSelectionKey = useRef<string | null>(null);

  useEffect(() => {
    let selectionKey: string | null = null;

    if (propertiesSelection?.kind === 'clip') {
      selectionKey = clips.some(clip => clip.id === propertiesSelection.clipId)
        ? `clip:${propertiesSelection.clipId}`
        : null;
    } else if (propertiesSelection?.kind === 'track') {
      selectionKey = tracks.some(track => track.id === propertiesSelection.trackId)
        ? `track:${propertiesSelection.trackId}`
        : null;
    } else if (propertiesSelection?.kind === 'master') {
      selectionKey = 'master';
    } else {
      const selectedId = selectedClipIds.size > 0 ? [...selectedClipIds][0] : null;
      selectionKey = selectedId && clips.some(clip => clip.id === selectedId)
        ? `clip:${selectedId}`
        : null;
    }

    // Only react to new selections (not deselections or same selection)
    if (!selectionKey || selectionKey === prevSelectionKey.current) {
      prevSelectionKey.current = selectionKey;
      return;
    }

    prevSelectionKey.current = selectionKey;

    // Activate Properties panel for clip, audio track, and master bus targets.
    activatePanelType('clip-properties');
  }, [selectedClipIds, propertiesSelection, clips, tracks, activatePanelType]);
}
