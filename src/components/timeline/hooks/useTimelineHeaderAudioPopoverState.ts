import { useCallback, useEffect, useRef, useState } from 'react';

export function useTimelineHeaderAudioPopoverState() {
  const [audioFxOpen, setAudioFxOpen] = useState(false);
  const [audioSendsOpen, setAudioSendsOpen] = useState(false);
  const audioFxPopoverRef = useRef<HTMLDivElement>(null);
  const audioSendsPopoverRef = useRef<HTMLDivElement>(null);

  // Capture phase: inside the mobile LiquidGlassBubble drawer, pointer-downs
  // stop propagating at the bubble root, so a bubbling document listener
  // would never see taps that must still dismiss an open popover.
  useEffect(() => {
    if (!audioFxOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (audioFxPopoverRef.current?.contains(event.target as Node)) return;
      setAudioFxOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [audioFxOpen]);

  useEffect(() => {
    if (!audioSendsOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (audioSendsPopoverRef.current?.contains(event.target as Node)) return;
      setAudioSendsOpen(false);
    };

    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => document.removeEventListener('pointerdown', handlePointerDown, true);
  }, [audioSendsOpen]);

  const closeAudioPopovers = useCallback(() => {
    setAudioFxOpen(false);
    setAudioSendsOpen(false);
  }, []);

  const toggleAudioFxOpen = useCallback(() => {
    setAudioSendsOpen(false);
    setAudioFxOpen(open => !open);
  }, []);

  const toggleAudioSendsOpen = useCallback(() => {
    setAudioFxOpen(false);
    setAudioSendsOpen(open => !open);
  }, []);

  return {
    audioFxOpen,
    audioFxPopoverRef,
    audioSendsOpen,
    audioSendsPopoverRef,
    closeAudioPopovers,
    toggleAudioFxOpen,
    toggleAudioSendsOpen,
  };
}

export type TimelineHeaderAudioPopoverState = ReturnType<typeof useTimelineHeaderAudioPopoverState>;
