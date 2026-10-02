import { useShallow } from 'zustand/react/shallow';
import { useTimelineStore } from '../../../stores/timeline';
import type { TimelineStore } from '../../../stores/timeline/types';
import { getPlayheadPosition } from '../../../services/layerBuilder/PlayheadState';

type PlaybackState = Pick<TimelineStore,
  'isPlaying' | 'isDraggingPlayhead' | 'isRamPreviewing' | 'isExporting' | 'playheadPosition'>;

export function selectTimelineEditorPlaybackState(state: PlaybackState) {
  return {
    isPlaying: state.isPlaying,
    isDraggingPlayhead: state.isDraggingPlayhead,
    // The engine, pointer playhead, and small time display own moving clocks.
    // Release/stop, RAM preview, and export publish their exact editor position.
    playheadPosition: (state.isPlaying || state.isDraggingPlayhead)
      && !state.isRamPreviewing && !state.isExporting ? null : state.playheadPosition,
  };
}

export function useTimelineEditorPlaybackState() {
  const state = useTimelineStore(useShallow(selectTimelineEditorPlaybackState));
  return {
    ...state,
    playheadPosition: state.playheadPosition ?? useTimelineStore.getState().playheadPosition,
  };
}

/** Event handlers outlive clock ticks; sample playback when the event occurs. */
export function readTimelinePlaybackPosition(editorPosition: number): number {
  const state = useTimelineStore.getState();
  if (state.isDraggingPlayhead) return state.playheadPosition;
  return state.isPlaying && !state.isDraggingPlayhead
    ? getPlayheadPosition(state.playheadPosition)
    : editorPosition;
}
