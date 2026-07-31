import type { FlashBoardChatMessage } from '../../../stores/flashboardStore';

export function canCopyFlashBoardChatMessage(message: FlashBoardChatMessage): boolean {
  return !message.isPending
    && !message.isError
    && Boolean(message.text.trim());
}
