import { useCallback, useLayoutEffect, useRef } from 'react';

interface UseFlashBoardPromptAutosizeInput {
  chatPanelOpen: boolean;
  chatPrompt: string;
  isAudioMode: boolean;
  multiShots: boolean;
  prompt: string;
}

export function useFlashBoardPromptAutosize({
  chatPanelOpen,
  chatPrompt,
  isAudioMode,
  multiShots,
  prompt,
}: UseFlashBoardPromptAutosizeInput) {
  const promptInputRef = useRef<HTMLTextAreaElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  const resizePromptInput = useCallback((textarea: HTMLTextAreaElement | null) => {
    if (!textarea) {
      return;
    }

    textarea.style.height = 'auto';

    const computedStyle = window.getComputedStyle(textarea);
    const minHeight = Number.parseFloat(computedStyle.minHeight);
    const maxHeight = Number.parseFloat(computedStyle.maxHeight);
    const lowerBound = Number.isFinite(minHeight) ? minHeight : 0;
    const upperBound = Number.isFinite(maxHeight) ? maxHeight : textarea.scrollHeight;
    const nextHeight = Math.ceil(Math.max(lowerBound, Math.min(textarea.scrollHeight, upperBound)));

    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > nextHeight + 1 ? 'auto' : 'hidden';
  }, []);

  useLayoutEffect(() => {
    resizePromptInput(chatPanelOpen ? chatInputRef.current : promptInputRef.current);
  }, [chatPanelOpen, chatPrompt, isAudioMode, multiShots, prompt, resizePromptInput]);

  return {
    chatInputRef,
    promptInputRef,
    resizePromptInput,
  };
}
