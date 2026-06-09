import { useLayoutEffect, useRef } from 'react';

interface UseFlashBoardChatHistoryScrollInput {
  chatError: string | null;
  chatMessages: readonly unknown[];
}

export function useFlashBoardChatHistoryScroll({
  chatError,
  chatMessages,
}: UseFlashBoardChatHistoryScrollInput) {
  const chatHistoryRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const historyNode = chatHistoryRef.current;
    if (!historyNode) {
      return;
    }

    historyNode.scrollTop = historyNode.scrollHeight;
  }, [chatError, chatMessages]);

  return chatHistoryRef;
}
