import { useCallback, useEffect, useRef, useState } from 'react';

interface MixerFaderDraftOptions {
  onPreviewValue?: (value: number) => void;
  onPreviewEnd?: () => void;
}

export function useMixerFaderDraft(
  committedValue: number,
  commitValue: (value: number) => void,
  options: MixerFaderDraftOptions = {},
) {
  const [draftValue, setDraftValue] = useState(committedValue);
  const [dragging, setDragging] = useState(false);
  const draggingRef = useRef(false);
  const latestValueRef = useRef(committedValue);
  const lastCommittedValueRef = useRef(committedValue);
  const awaitingStoreValueRef = useRef<number | null>(null);
  const commitValueRef = useRef(commitValue);
  const previewValueRef = useRef(options.onPreviewValue);
  const previewEndRef = useRef(options.onPreviewEnd);

  useEffect(() => {
    commitValueRef.current = commitValue;
  }, [commitValue]);

  useEffect(() => {
    previewValueRef.current = options.onPreviewValue;
    previewEndRef.current = options.onPreviewEnd;
  }, [options.onPreviewEnd, options.onPreviewValue]);

  const commitNow = useCallback((value = latestValueRef.current) => {
    latestValueRef.current = value;
    setDraftValue(value);
    if (!Object.is(lastCommittedValueRef.current, value)) {
      lastCommittedValueRef.current = value;
      awaitingStoreValueRef.current = value;
      commitValueRef.current(value);
    }
    previewEndRef.current?.();
  }, []);

  const setDraft = useCallback((value: number) => {
    latestValueRef.current = value;
    if (draggingRef.current) {
      previewValueRef.current?.(value);
      return;
    }
    setDraftValue(value);
    commitNow(value);
  }, [commitNow]);

  const beginDrag = useCallback(() => {
    draggingRef.current = true;
    setDragging(true);
    previewValueRef.current?.(latestValueRef.current);
  }, []);

  const endDrag = useCallback(() => {
    const wasDragging = draggingRef.current;
    draggingRef.current = false;
    setDragging(false);
    if (wasDragging) {
      commitNow();
    } else {
      previewEndRef.current?.();
    }
  }, [commitNow]);

  useEffect(() => {
    if (dragging) return;
    if (awaitingStoreValueRef.current !== null) {
      if (Object.is(committedValue, awaitingStoreValueRef.current)) {
        awaitingStoreValueRef.current = null;
      } else {
        return;
      }
    }
    latestValueRef.current = committedValue;
    lastCommittedValueRef.current = committedValue;
    setDraftValue(committedValue);
  }, [committedValue, dragging]);

  useEffect(() => {
    if (!dragging || typeof window === 'undefined') return undefined;
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    window.addEventListener('mouseup', endDrag);
    window.addEventListener('touchend', endDrag);
    window.addEventListener('blur', endDrag);
    return () => {
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
      window.removeEventListener('mouseup', endDrag);
      window.removeEventListener('touchend', endDrag);
      window.removeEventListener('blur', endDrag);
    };
  }, [dragging, endDrag]);

  useEffect(() => () => {
    previewEndRef.current?.();
  }, []);

  return {
    value: draftValue,
    beginDrag,
    endDrag,
    setDraft,
    commitNow,
    dragging,
  };
}
