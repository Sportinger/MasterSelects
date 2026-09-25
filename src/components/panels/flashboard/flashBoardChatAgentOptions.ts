import type { FlashBoardChatAgentMode } from '../../../services/flashboard/FlashBoardChatService';

export const FLASHBOARD_CHAT_AGENT_OPTIONS = [
  {
    id: 'standard',
    label: 'Fast',
    title: 'Fast: the Codex Direct workflow running on DeepSeek V4.1 Flash.',
  },
  {
    id: 'direct',
    label: 'Codex Direct',
    title: 'Codex Direct: one isolated Codex session controls MasterSelects tools without the kernel workflow.',
  },
] as const satisfies ReadonlyArray<{
  id: FlashBoardChatAgentMode;
  label: string;
  title: string;
}>;

export const FLASHBOARD_CHAT_AGENT_OPTION_COUNT = FLASHBOARD_CHAT_AGENT_OPTIONS.length;
