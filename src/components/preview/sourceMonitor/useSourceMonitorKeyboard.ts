import { useCallback, useEffect, useRef } from 'react';

import {
  claimShortcut,
  isTextEntryTarget,
} from '../../../services/shortcutFocusPolicy';
import { getShortcutRegistry } from '../../../services/shortcutRegistry';

interface UseSourceMonitorKeyboardOptions {
  isPlayable: boolean;
  onClose: () => void;
  togglePlayback: () => void;
}

export function useSourceMonitorKeyboard({
  isPlayable,
  onClose,
  togglePlayback,
}: UseSourceMonitorKeyboardOptions) {
  const rootRef = useRef<HTMLDivElement>(null);
  const hoveredRef = useRef(false);
  const handlePointerEnter = useCallback(() => {
    hoveredRef.current = true;
  }, []);
  const handlePointerLeave = useCallback(() => {
    hoveredRef.current = false;
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        isTextEntryTarget(event.target) ||
        isTextEntryTarget(document.activeElement)
      ) {
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        return;
      }

      if (
        !(hoveredRef.current || rootRef.current?.matches(':hover')) ||
        !isPlayable ||
        !getShortcutRegistry().matches('playback.playPause', event)
      ) {
        return;
      }

      if (!claimShortcut(event, 'playback.playPause', {
        blurFocusedControl: true,
        deferToFocusedControl: false,
        stopImmediatePropagation: true,
      })) {
        return;
      }
      togglePlayback();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isPlayable, onClose, togglePlayback]);

  return {
    handlePointerEnter,
    handlePointerLeave,
    rootRef,
  };
}
