import { useEffect } from 'react';

import { claimShortcut } from '../../services/shortcutFocusPolicy';
import { getShortcutRegistry } from '../../services/shortcutRegistry';
import { useTimelineStore } from '../../stores/timeline';
import { usePlaybackLoop } from '../timeline/hooks/usePlaybackLoop';

function useEditorPlaybackShortcut() {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!getShortcutRegistry().matches('playback.playPause', event)) return;
      if (!claimShortcut(event, 'playback.playPause', {
        blurFocusedControl: true,
        deferToFocusedControl: false,
      })) return;

      const timelineState = useTimelineStore.getState();
      if (timelineState.isPlaying) {
        timelineState.pause();
      } else {
        void timelineState.play();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
}

/**
 * Owns composition playback independently of the currently mounted dock layout.
 * Timeline, Color, and other workspace transports and shortcuts all control the
 * same store.
 */
export function EditorPlaybackRuntimeHost() {
  const isPlaying = useTimelineStore(state => state.isPlaying);
  useEditorPlaybackShortcut();
  usePlaybackLoop({ isPlaying });
  return null;
}
