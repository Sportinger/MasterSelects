import type { FlashBoardChatMessage } from '../../stores/flashboardStore/types';
import { redactFlashBoardChatImageData } from '../flashboard/FlashBoardChatImageData';
import type { ProjectFlashBoardChatMessage } from './types/flashboard.types';

export function serializeFlashBoardChatMessage(
  message: FlashBoardChatMessage,
): ProjectFlashBoardChatMessage {
  return {
    id: message.id,
    role: message.role,
    text: message.text,
    createdAt: message.createdAt ? new Date(message.createdAt).toISOString() : undefined,
    editOptions: message.editOptions,
    isError: message.isError,
    isPending: message.isPending,
    toolCalls: redactFlashBoardChatImageData(message.toolCalls),
  };
}

export function normalizeFlashBoardChatMessage(
  message: ProjectFlashBoardChatMessage,
): FlashBoardChatMessage | null {
  if (
    (message.role !== 'user' && message.role !== 'assistant')
    || typeof message.text !== 'string'
  ) {
    return null;
  }

  const createdAt = message.createdAt ? new Date(message.createdAt).getTime() : undefined;
  const wasPending = message.isPending === true;
  return {
    id: typeof message.id === 'string' && message.id.trim() ? message.id : crypto.randomUUID(),
    role: message.role,
    text: wasPending ? 'Chat interrupted by reload.' : message.text,
    createdAt: createdAt !== undefined && Number.isFinite(createdAt) ? createdAt : undefined,
    editOptions: Array.isArray(message.editOptions) ? message.editOptions : undefined,
    isError: message.isError || wasPending || undefined,
    isPending: false,
    toolCalls: Array.isArray(message.toolCalls)
      ? redactFlashBoardChatImageData(message.toolCalls)
      : undefined,
  };
}

export function normalizeFlashBoardChatMessages(
  messages: ProjectFlashBoardChatMessage[] | undefined,
): FlashBoardChatMessage[] {
  return Array.isArray(messages)
    ? messages
      .map(normalizeFlashBoardChatMessage)
      .filter((message): message is FlashBoardChatMessage => message !== null)
    : [];
}
