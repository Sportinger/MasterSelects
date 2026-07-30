import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  addMultiPrompt,
  createDefaultMultiPrompts,
  type FlashBoardMultishotPlannerPrompt,
  MAX_MULTI_SHOTS,
  rebalanceMultiPrompts,
  removeMultiPrompt,
} from './FlashBoardMultishotPlanner';

const MULTI_SHOT_PANEL_EXIT_MS = 190;

interface UseFlashBoardMultishotControllerOptions {
  duration: number;
  generateAudio: boolean;
  isAudioMode: boolean;
  selectionKey: string;
  selectedEntryOutputType?: string;
  setGenerateAudio: Dispatch<SetStateAction<boolean>>;
  supportsAudio: boolean;
  supportsMultiShot: boolean;
}

export function useFlashBoardMultishotController({
  duration,
  generateAudio,
  isAudioMode,
  selectionKey,
  selectedEntryOutputType,
  setGenerateAudio,
  supportsAudio,
  supportsMultiShot,
}: UseFlashBoardMultishotControllerOptions) {
  const [multiShots, setMultiShots] = useState(false);
  const [renderMultiShotPanel, setRenderMultiShotPanel] = useState(false);
  const [isMultiShotPanelClosing, setIsMultiShotPanelClosing] = useState(false);
  const [multiPrompt, setMultiPrompt] = useState<FlashBoardMultishotPlannerPrompt[]>([]);
  const audioBeforeMultiShotRef = useRef(generateAudio);
  const previousSelectionKeyRef = useRef(selectionKey);
  const selectionChanged = previousSelectionKeyRef.current !== selectionKey;

  const normalizedMultiPrompt = useMemo(
    () => rebalanceMultiPrompts(multiPrompt, duration),
    [duration, multiPrompt],
  );
  const multiShotDurationTotal = useMemo(
    () => normalizedMultiPrompt.reduce((sum, shot) => sum + shot.duration, 0),
    [normalizedMultiPrompt],
  );
  const canAddShot = multiShots && normalizedMultiPrompt.length < Math.min(MAX_MULTI_SHOTS, Math.max(1, duration));

  useEffect(() => {
    if (!selectionChanged) {
      return;
    }

    previousSelectionKeyRef.current = selectionKey;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setMultiShots(false);
      setRenderMultiShotPanel(false);
      setIsMultiShotPanelClosing(false);
      setMultiPrompt([]);
    });

    return () => {
      cancelled = true;
    };
  }, [selectionChanged, selectionKey]);

  useEffect(() => {
    if (selectedEntryOutputType === undefined) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;

      if ((isAudioMode || !supportsAudio || selectedEntryOutputType === 'image') && generateAudio) {
        setGenerateAudio(false);
      }

      if ((isAudioMode || !supportsMultiShot || selectedEntryOutputType === 'image') && multiShots) {
        setMultiShots(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    generateAudio,
    isAudioMode,
    multiShots,
    selectedEntryOutputType,
    setGenerateAudio,
    supportsAudio,
    supportsMultiShot,
  ]);

  useEffect(() => {
    if (!multiShots || selectionChanged) {
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;

      if (!generateAudio) {
        setGenerateAudio(true);
      }

      setMultiPrompt((current) => (
        current.length > 0
          ? rebalanceMultiPrompts(current, duration)
          : createDefaultMultiPrompts(duration)
      ));
    });

    return () => {
      cancelled = true;
    };
  }, [duration, generateAudio, multiShots, selectionChanged, setGenerateAudio]);

  useEffect(() => {
    if (selectionChanged) {
      return;
    }

    let cancelled = false;
    let timeoutId: number | null = null;

    queueMicrotask(() => {
      if (cancelled) return;

      if (multiShots) {
        setRenderMultiShotPanel(true);
        setIsMultiShotPanelClosing(false);
        return;
      }

      if (!renderMultiShotPanel) {
        setIsMultiShotPanelClosing(false);
        return;
      }

      setIsMultiShotPanelClosing(true);
      timeoutId = window.setTimeout(() => {
        setRenderMultiShotPanel(false);
        setIsMultiShotPanelClosing(false);
        setMultiPrompt([]);
      }, MULTI_SHOT_PANEL_EXIT_MS);
    });

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [multiShots, renderMultiShotPanel, selectionChanged]);

  const handleMultiShotToggle = useCallback(() => {
    if (!supportsMultiShot) {
      return;
    }

    setMultiShots((current) => {
      const next = !current;

      if (next) {
        audioBeforeMultiShotRef.current = generateAudio;
        setGenerateAudio(true);
        setMultiPrompt((existing) => (
          existing.length > 0
            ? rebalanceMultiPrompts(existing, duration)
            : createDefaultMultiPrompts(duration)
        ));
      } else {
        setGenerateAudio(audioBeforeMultiShotRef.current);
      }

      return next;
    });
  }, [duration, generateAudio, setGenerateAudio, supportsMultiShot]);

  const handleShotPromptChange = useCallback((index: number, value: string) => {
    setMultiPrompt((current) => current.map((shot, shotIndex) => (
      shotIndex === index ? { ...shot, prompt: value } : shot
    )));
  }, []);

  const handleShotDurationChange = useCallback((index: number, value: string) => {
    const nextDuration = Math.max(1, Math.floor(Number(value) || 1));
    setMultiPrompt((current) => rebalanceMultiPrompts(
      current.map((shot, shotIndex) => (
        shotIndex === index ? { ...shot, duration: nextDuration } : shot
      )),
      duration,
    ));
  }, [duration]);

  const handleAddShot = useCallback(() => {
    setMultiPrompt((current) => addMultiPrompt(current, duration));
  }, [duration]);

  const handleRemoveShot = useCallback((index: number) => {
    setMultiPrompt((current) => removeMultiPrompt(current, index, duration));
  }, [duration]);

  return {
    canAddShot,
    handleAddShot,
    handleMultiShotToggle,
    handleRemoveShot,
    handleShotDurationChange,
    handleShotPromptChange,
    isMultiShotPanelClosing,
    multiShotDurationTotal,
    multiShots,
    normalizedMultiPrompt,
    renderMultiShotPanel,
  };
}
