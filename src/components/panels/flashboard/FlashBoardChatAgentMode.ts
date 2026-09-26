import type { FlashBoardChatAgentMode } from '../../../services/flashboard/FlashBoardChatService';

export const DEFAULT_FLASHBOARD_CHAT_AGENT_MODE: FlashBoardChatAgentMode = 'direct';

export const FLASHBOARD_CHAT_AGENT_MODE_STORAGE_KEY = 'ms.flashboard.chatAgentMode';

const PERSISTABLE_AGENT_MODES: readonly FlashBoardChatAgentMode[] = ['standard', 'direct-medium', 'direct'];

/** Returns the last explicitly selected Fast/Medium/Slow mode, or null when none was stored. */
export function loadStoredFlashBoardChatAgentMode(): FlashBoardChatAgentMode | null {
  try {
    const stored = globalThis.localStorage?.getItem(FLASHBOARD_CHAT_AGENT_MODE_STORAGE_KEY);
    return PERSISTABLE_AGENT_MODES.find((mode) => mode === stored) ?? null;
  } catch {
    return null;
  }
}

export function storeFlashBoardChatAgentMode(mode: FlashBoardChatAgentMode): void {
  if (!PERSISTABLE_AGENT_MODES.includes(mode)) return;
  try {
    globalThis.localStorage?.setItem(FLASHBOARD_CHAT_AGENT_MODE_STORAGE_KEY, mode);
  } catch {
    // Storage can be unavailable (private mode, blocked site data); the choice stays session-only.
  }
}

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
