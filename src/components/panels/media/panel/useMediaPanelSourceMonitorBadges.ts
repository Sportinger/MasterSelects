import { useCallback } from 'react';
import { useDockStore } from '../../../../stores/dockStore';
import { useTimelineStore } from '../../../../stores/timeline';
import type { MediaClassicBadgeTarget } from '../list/types';

export function useMediaPanelSourceMonitorBadges() {
  return useCallback((mediaFileId: string, tab: MediaClassicBadgeTarget) => {
    const timelineState = useTimelineStore.getState();
    const clip = timelineState.clips.find((candidate) => (
      (candidate.source?.mediaFileId || candidate.mediaFileId) === mediaFileId
    ));

    if (clip) {
      timelineState.selectClip(clip.id);
    }

    useDockStore.getState().activatePanelType('clip-properties');
    requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('openPropertiesTab', { detail: { tab } }));
    });
  }, []);
}
