// Whether the chosen placement mode can place right now, and the line that says where: re-read from
// the editor's placement preview whenever the playhead, selection, clips or source marks change.
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useMediaStore } from '../../../stores/mediaStore';
import { useTimelineStore } from '../../../stores/timeline';
import { phoneSourcePreview, phoneSourceTargetClip, phoneTrackName } from './phoneSourceCommands';
import {
  describePhoneSourcePreview, PHONE_SOURCE_MODES, PHONE_SOURCE_TARGET_REASON, type PhoneSourceMode,
} from './phoneSourceModel';

/** Whether `mode` can place right now, and the line that says where (re-read when the timeline changes). */
export function usePhoneSourcePlan(mode: PhoneSourceMode, trackType: 'video' | 'audio') {
  const timeline = useTimelineStore(useShallow((state) => ({
    playhead: state.playheadPosition, selected: state.selectedClipIds, clips: state.clips, tracks: state.tracks,
  })));
  const marks = useMediaStore(useShallow((state) => [state.sourceMonitorFileId, state.sourceMonitorInPoint, state.sourceMonitorOutPoint]));
  return useMemo(() => {
    void timeline; void marks;
    const target = phoneSourceTargetClip(trackType);
    const info = PHONE_SOURCE_MODES.find((entry) => entry.id === mode)!;
    if (info.needsTarget && !target) return { ok: false, text: PHONE_SOURCE_TARGET_REASON, target };
    return { ...describePhoneSourcePreview(mode, phoneSourcePreview(mode), phoneTrackName), target };
  }, [mode, trackType, timeline, marks]);
}
