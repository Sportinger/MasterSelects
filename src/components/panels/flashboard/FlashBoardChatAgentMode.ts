import type { FlashBoardChatAgentMode } from '../../../services/flashboard/FlashBoardChatService';

export const DEFAULT_FLASHBOARD_CHAT_AGENT_MODE: FlashBoardChatAgentMode = 'direct';

export function resolveFlashBoardChatAgentMode(input: {
  availableAgentModes: readonly FlashBoardChatAgentMode[];
  currentAgentMode: FlashBoardChatAgentMode;
  explicitlySelected: boolean;
}): FlashBoardChatAgentMode {
  if ((input.currentAgentMode === 'standard' || input.currentAgentMode === 'direct-medium') && input.explicitlySelected) {
    return input.currentAgentMode;
  }
  return 'direct';
}
